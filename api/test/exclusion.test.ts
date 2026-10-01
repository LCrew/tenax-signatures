import { describe, expect, it } from 'vitest';
import { withMailboxFlag } from '../src/services/directory.js';
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
