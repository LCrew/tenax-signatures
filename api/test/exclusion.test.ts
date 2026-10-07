import { describe, expect, it } from 'vitest';
import { skipReasons, withMailboxFlag } from '../src/services/directory.js';
import { makeApp, mock } from './helpers.js';

const IT = mock('test.tenax@tenaxgrupa.lv');
const EDITOR = mock('test.lv@tenaxgrupa.lv'); // Tenapors signature editor

describe('mailbox licence filter', () => {
  const base = { id: '1', userPrincipalName: 'a@x', mail: 'a@x', displayName: 'A', jobTitle: null, mobilePhone: null, businessPhones: [], department: null };
  it('needs an enabled Exchange plan, not just any licence', () => {
    expect(withMailboxFlag({ ...base, assignedPlans: [{ service: 'exchange', capabilityStatus: 'Enabled' }] } as any).hasMailbox).toBe(true);
    expect(withMailboxFlag({ ...base, assignedPlans: [{ service: 'PowerBI', capabilityStatus: 'Enabled' }] } as any).hasMailbox).toBe(false);
    expect(withMailboxFlag({ ...base, assignedPlans: [{ service: 'exchange', capabilityStatus: 'Deleted' }] } as any).hasMailbox).toBe(false);
    expect(withMailboxFlag({ ...base, assignedPlans: [] } as any).hasMailbox).toBe(false);
    expect('assignedPlans' in withMailboxFlag({ ...base, assignedPlans: [] } as any)).toBe(false);
  });

  it('keeps whether it is licensed and what state its Exchange plan is in', () => {
    const u = withMailboxFlag({ ...base, assignedLicenses: [{}], assignedPlans: [{ service: 'exchange', capabilityStatus: 'Deleted' }] } as any);
    expect(u).toMatchObject({ licensed: true, hasMailbox: false, exchangeStatus: 'Deleted' });
    expect('assignedLicenses' in u).toBe(false);
    expect(withMailboxFlag({ ...base, assignedLicenses: [], assignedPlans: [] } as any)).toMatchObject({ licensed: false, exchangeStatus: null });
  });

  it('explains why an account is left out', () => {
    const ok = { ...base, userType: 'Member', accountEnabled: true, licensed: true, hasMailbox: true, exchangeStatus: 'Enabled' };
    expect(skipReasons(ok)).toEqual([]);
    expect(skipReasons({ ...ok, userType: 'Guest' })).toEqual(['guest']);
    expect(skipReasons({ ...ok, accountEnabled: false })).toEqual(['disabled']);
    expect(skipReasons({ ...ok, licensed: false, hasMailbox: false, exchangeStatus: null })).toEqual(['unlicensed']);
    expect(skipReasons({ ...ok, hasMailbox: false, exchangeStatus: null })).toEqual(['noMailbox']);
    expect(skipReasons({ ...ok, hasMailbox: false, exchangeStatus: 'Suspended' })).toEqual(['mailboxOff']);
    expect(skipReasons({ ...ok, accountEnabled: false, licensed: false, hasMailbox: false })).toEqual(['disabled', 'unlicensed']);
    // Demo data without these fields counts as qualifying.
    expect(skipReasons(base)).toEqual([]);
  });
});

describe('accounts the directory leaves out', async () => {
  const { app } = await makeApp();
  const list = (h = IT, q = '') => app.inject({ url: `/api/admin/users${q}`, headers: h }).then((r) => r.json());

  it('are listed under Skipped with why, and nowhere else', async () => {
    const skipped = await list(IT, '?view=skipped');
    expect(skipped.map((u: any) => [u.upn, u.skipped, u.sharedMailbox])).toEqual([
      ['test.powerbi@tenaxgrupa.lv', ['noMailbox'], false],
      ['test.blocked@tenaxgrupa.lv', ['disabled'], false],
      ['info@tenaxgrupa.lv', ['disabled', 'unlicensed'], true],
    ]);
    const shown = [...(await list()), ...(await list(IT, '?view=excluded'))].map((u: any) => u.upn);
    for (const u of skipped) expect(shown).not.toContain(u.upn);
    expect((await app.inject({ url: '/api/admin/report', headers: IT })).json().total).toBe(9);
  });

  it('their person page says why', async () => {
    const detail = (await app.inject({ url: '/api/admin/users/test.blocked@tenaxgrupa.lv', headers: IT })).json();
    expect(detail).toMatchObject({ skipped: ['disabled'], sharedMailbox: false });
  });

  it('only IT sees the list', async () => {
    expect((await list(EDITOR, '?view=skipped')).map((u: any) => u.upn)).not.toContain('test.blocked@tenaxgrupa.lv');
  });
});

describe('excluding accounts', async () => {
  const { app, ctx } = await makeApp();
  const users = (h = IT, q = '') => app.inject({ url: `/api/admin/users${q}`, headers: h }).then((r) => r.json().map((u: any) => u.upn));

  it('IT excludes an account: gone from People, report and signature', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/admin/users/test.nogroup@tenaxgrupa.lv/exclusion', headers: IT, payload: { excluded: true, reason: 'Scanner mailbox' } });
    expect(res.statusCode).toBe(200);
    expect(await users()).not.toContain('test.nogroup@tenaxgrupa.lv');
    expect(await users(IT, '?view=excluded')).toEqual(['test.nogroup@tenaxgrupa.lv']);
    const report = (await app.inject({ url: '/api/admin/report', headers: IT })).json();
    expect(report.rows.map((r: any) => r.upn)).not.toContain('test.nogroup@tenaxgrupa.lv');
    expect(report.excluded).toBe(1);
    expect((await app.inject({ url: '/api/signature?type=newMail', headers: mock('test.nogroup@tenaxgrupa.lv') })).statusCode).toBe(204);
    const detail = (await app.inject({ url: '/api/admin/users/test.nogroup@tenaxgrupa.lv', headers: IT })).json();
    expect(detail.excluded).toMatchObject({ by: 'manual', reason: 'Scanner mailbox', excludedBy: 'test.tenax@tenaxgrupa.lv' });
  });

  it('and includes it again', async () => {
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.nogroup@tenaxgrupa.lv/exclusion', headers: IT, payload: { excluded: false } });
    expect(await users()).toContain('test.nogroup@tenaxgrupa.lv');
    expect((await app.inject({ url: '/api/signature?type=newMail', headers: mock('test.nogroup@tenaxgrupa.lv') })).statusCode).toBe(200);
  });

  it('members of the exclusion group are excluded and can only be included by leaving the group', async () => {
    ctx.settings.update({ excludeGroupId: '00000000-0000-0000-0000-00000000a002' }); // reuse Tenapors' group as a stand-in
    ctx.resolver.clearCache();
    expect(await users()).not.toContain('test.tenapors@tenaxgrupa.lv');
    const res = await app.inject({ method: 'PUT', url: '/api/admin/users/test.tenapors@tenaxgrupa.lv/exclusion', headers: IT, payload: { excluded: false } });
    expect(res.statusCode).toBe(409);
    ctx.settings.update({ excludeGroupId: '' });
    ctx.resolver.clearCache();
  });

  it('company editors can neither see excluded accounts nor change exclusions', async () => {
    await app.inject({ method: 'PUT', url: '/api/admin/users/test.tenapors@tenaxgrupa.lv/exclusion', headers: IT, payload: { excluded: true } });
    expect(await users(EDITOR)).not.toContain('test.tenapors@tenaxgrupa.lv');
    expect(await users(EDITOR, '?view=excluded')).not.toContain('test.tenapors@tenaxgrupa.lv');
    expect((await app.inject({ url: '/api/admin/users/test.tenapors@tenaxgrupa.lv', headers: EDITOR })).statusCode).toBe(404);
    const put = await app.inject({ method: 'PUT', url: '/api/admin/users/test.lv@tenaxgrupa.lv/exclusion', headers: EDITOR, payload: { excluded: true } });
    expect(put.statusCode).toBe(403);
  });
});
