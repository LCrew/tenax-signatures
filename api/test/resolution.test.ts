import { describe, expect, it } from 'vitest';
import { resolveCompany, resolveFields } from '../src/services/resolver.js';
import { normalizePhone } from '../src/services/phone.js';
import type { Company, DirectoryUser } from '../src/types.js';
import { makeApp } from './helpers.js';

const companies: Company[] = [
  { key: 'tenax', displayName: 'Tenax', legalName: 'SIA "Tenax"', groupName: 'A', groupId: 'aaa', priority: 1 },
  { key: 'vareno', displayName: 'Vareno', legalName: 'SIA "Vareno Group"', groupName: 'D', groupId: 'ddd', priority: 4 },
];

describe('company resolution (pure)', () => {
  it('uses the single matching group', () => {
    expect(resolveCompany(['ddd'], companies, null, 'tenax')).toMatchObject({ company: 'vareno', source: 'group', conflict: false });
  });
  it('matches group IDs case-insensitively', () => {
    expect(resolveCompany(['DDD'], companies, null, 'tenax').company).toBe('vareno');
  });
  it('uses priority on multi-group and flags a conflict', () => {
    expect(resolveCompany(['ddd', 'aaa'], companies, null, 'vareno')).toMatchObject({ company: 'tenax', conflict: true, candidates: ['tenax', 'vareno'] });
  });
  it('an admin-chosen company wins over group membership and settles conflicts', () => {
    expect(resolveCompany([], companies, 'vareno', 'tenax')).toMatchObject({ company: 'vareno', source: 'override' });
    expect(resolveCompany(['aaa'], companies, 'vareno', 'tenax')).toMatchObject({ company: 'vareno', source: 'override' });
    expect(resolveCompany(['ddd', 'aaa'], companies, 'vareno', 'tenax')).toMatchObject({ company: 'vareno', source: 'override', conflict: false, candidates: ['tenax', 'vareno'] });
    // "From group membership" (no override) goes back to groups.
    expect(resolveCompany(['ddd', 'aaa'], companies, null, 'tenax')).toMatchObject({ company: 'tenax', source: 'group', conflict: true });
  });
  it('ignores an override pointing at an unknown company and falls back to default', () => {
    expect(resolveCompany([], companies, 'ghost', 'vareno')).toMatchObject({ company: 'vareno', source: 'default' });
  });
});

describe('field precedence (pure)', () => {
  const entra: DirectoryUser = {
    id: '1', userPrincipalName: 'a@x.lv', mail: 'a@x.lv', displayName: 'Entra Name', jobTitle: 'Old title',
    mobilePhone: '29123456', businessPhones: [], department: '  ',
  };
  it('override > Entra > omitted', () => {
    const r = resolveFields(entra, { upn: 'a@x.lv', jobTitleLv: 'New title', jobTitleEn: '' });
    expect(r.fields.jobTitleLv).toBe('New title');
    expect(r.sources.jobTitleLv).toBe('override');
    expect(r.fields.displayName).toBe('Entra Name');
    expect(r.sources.displayName).toBe('entra');
    expect(r.fields.jobTitleEn).toBeNull(); // empty override doesn't count
    expect(r.fields.department).toBeNull(); // whitespace-only is missing
    expect(r.fields.officePhone).toBeNull();
    expect(r.missing).not.toContain('officePhone'); // not needed in signatures
    expect(r.missing).not.toContain('department');
  });
  it('a mobile hidden on purpose is not missing', () => {
    const entra = { id: '1', userPrincipalName: 'a@x.lv', displayName: 'A', jobTitle: 'B', mobilePhone: null } as any;
    expect(resolveFields(entra, null).missing).toContain('mobilePhone');
    expect(resolveFields(entra, { upn: 'a@x.lv', hideMobile: true }).missing).not.toContain('mobilePhone');
  });
  it('email always comes from Entra', () => {
    const r = resolveFields(entra, { upn: 'a@x.lv', displayName: 'X' });
    expect(r.fields.email).toBe('a@x.lv');
  });
});

describe('phone normalisation', () => {
  it.each([
    ['29123456', '+371 29 123 456'],
    ['+37129123456', '+371 29 123 456'],
    ['00371 29 12 34 56', '+371 29 123 456'],
    ['371 67123456', '+371 67 123 456'],
    ['+44 20 7946 0958', '+44 20 7946 0958'],
    ['', null],
    [null, null],
  ])('%s → %s', (input, expected) => expect(normalizePhone(input as any)).toBe(expected));
});

describe('fixture users (all brief §8.1 cases)', async () => {
  const { ctx } = await makeApp();
  const r = (upn: string) => ctx.resolver.resolve(upn);

  it('test.tenax: Tenax, all fields', async () => {
    const u = (await r('test.tenax@tenaxgrupa.lv'))!;
    expect(u.company).toBe('tenax');
    expect(u.missing).toEqual([]);
  });
  it('test.tenapors: missing jobTitle', async () => {
    const u = (await r('test.tenapors@tenaxgrupa.lv'))!;
    expect(u.company).toBe('tenapors');
    expect(u.fields.jobTitleLv).toBeNull();
    expect(u.missing).toContain('jobTitleLv');
  });
  it('test.panel: override title wins over outdated Entra title', async () => {
    const u = (await r('test.panel@tenaxgrupa.lv'))!;
    expect(u.company).toBe('tenaxpanel');
    expect(u.fields.jobTitleLv).toBe('Tehniskais direktors');
    expect(u.sources.jobTitleLv).toBe('override');
  });
  it('test.vareno: no mobile', async () => {
    const u = (await r('test.vareno@tenaxgrupa.lv'))!;
    expect(u.company).toBe('vareno');
    expect(u.fields.mobilePhone).toBeNull();
  });
  it('test.multi: priority winner + conflict', async () => {
    const u = (await r('test.multi@tenaxgrupa.lv'))!;
    expect(u.company).toBe('tenax');
    expect(u.conflict).toBe(true);
  });
  it('test.nogroup: default company', async () => {
    const u = (await r('test.nogroup@tenaxgrupa.lv'))!;
    expect(u.company).toBe('tenax');
    expect(u.companySource).toBe('default');
  });
});
