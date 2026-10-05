import { describe, expect, it } from 'vitest';
import { makeApp, mock } from './helpers.js';
import { parseCsv } from '../src/services/csvimport.js';

const IT = mock('test.tenax@tenaxgrupa.lv');
const TENAPORS_EDITOR = mock('test.lv@tenaxgrupa.lv');

describe('parseCsv', () => {
  it('reads quotes, escaped quotes, CRLF, a BOM and semicolons', () => {
    const rows = parseCsv('﻿upn;jobTitleEn\r\na@x.lv;"Head of ""Sales""; Riga"\r\n\r\nb@x.lv;Driver\r\n');
    expect(rows).toEqual([
      { line: 1, cells: ['upn', 'jobTitleEn'] },
      { line: 2, cells: ['a@x.lv', 'Head of "Sales"; Riga'] },
      { line: 4, cells: ['b@x.lv', 'Driver'] },
    ]);
  });
});

describe('missing details CSV import', async () => {
  const { app, repo } = await makeApp();
  const post = (csv: string, dryRun?: boolean, headers = IT) =>
    app.inject({ method: 'POST', url: '/api/admin/import/missing', headers, payload: { csv, ...(dryRun === undefined ? {} : { dryRun }) } });

  it('exports the people with gaps, blanks where something is missing', async () => {
    const res = await app.inject({ url: '/api/admin/missing.csv', headers: IT });
    const lines = res.body.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe('upn,company,missing,department,displayName,jobTitleLv,jobTitleEn,mobilePhone,noMobile');
    const tenapors = lines.find((l) => l.startsWith('test.tenapors@'))!;
    expect(tenapors).toContain('jobTitleLv jobTitleEn');
    expect(tenapors).toContain(",Anna Bērziņa,,,'+371 26 555 444,");
  });

  it('checks without saving by default', async () => {
    const res = await post('upn,jobTitleLv,jobTitleEn\ntest.tenapors@tenaxgrupa.lv,Loģistikas vadītāja,Logistics Manager\n');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ dryRun: true, totals: { update: 1, unchanged: 0, error: 0 } });
    expect(res.json().rows[0].changes).toEqual({ jobTitleLv: 'Loģistikas vadītāja', jobTitleEn: 'Logistics Manager' });
    expect(repo.getOverrides('test.tenapors@tenaxgrupa.lv')?.jobTitleLv ?? null).toBeNull();
  });

  it('fills only missing fields; values already set are kept and reported', async () => {
    const csv = [
      'upn,company,displayName,jobTitleLv,jobTitleEn,mobilePhone,noMobile',
      'TEST.INSTALL@tenaxgrupa.lv,tenaxinstall,Kārlis Vītols,Cits amats,Foreman,,',
      "test.vareno@tenaxgrupa.lv,vareno,,,Accountant,,yes",
      "test.multi@tenaxgrupa.lv,vareno,,,,'+371 29 888 777,",
      'nobody@tenaxgrupa.lv,,,,Ghost,,',
      'test.nogroup@tenaxgrupa.lv,,,,Assistant,12ab,',
      'test.install@tenaxgrupa.lv,,,,Again,,',
    ].join('\n');
    const plan = (await post(csv, false)).json();
    expect(plan.ignoredColumns).toEqual(['company']);
    const [install, vareno, multi, nobody, nogroup, dup] = plan.rows;
    expect(install).toMatchObject({ status: 'update', changes: { jobTitleEn: 'Foreman' } });
    expect(install.notes[0]).toContain('jobTitleLv already set');
    expect(vareno).toMatchObject({ status: 'update', changes: { jobTitleEn: 'Accountant', hideMobile: true } });
    expect(multi).toMatchObject({ status: 'unchanged', notes: [] }); // same number, just formatted
    expect(nobody.status).toBe('error');
    expect(nogroup.error).toContain('mobilePhone');
    expect(dup.error).toContain('earlier');
    expect(plan.totals).toEqual({ update: 2, unchanged: 1, error: 3 });

    expect(repo.getOverrides('test.install@tenaxgrupa.lv')).toMatchObject({ jobTitleEn: 'Foreman', updatedBy: 'test.tenax@tenaxgrupa.lv' });
    expect(repo.getOverrides('test.install@tenaxgrupa.lv')?.jobTitleLv ?? null).toBeNull();
    expect(repo.getOverrides('test.vareno@tenaxgrupa.lv')).toMatchObject({ hideMobile: true, jobTitleEn: 'Accountant' });
    expect(repo.getOverrides('test.nogroup@tenaxgrupa.lv')?.jobTitleEn ?? null).toBeNull();
    const vRes = (await app.inject({ url: '/api/admin/users/test.vareno@tenaxgrupa.lv', headers: IT })).json();
    expect(vRes.missing).toEqual([]);
  });

  it('editors can only import for their own company', async () => {
    const csv = 'upn,jobTitleEn\ntest.tenax@tenaxgrupa.lv,Hacked\ntest.tenapors@tenaxgrupa.lv,Logistics Manager\n';
    const plan = (await post(csv, false, TENAPORS_EDITOR)).json();
    expect(plan.rows.map((r: any) => r.status)).toEqual(['error', 'update']);
    expect(repo.getOverrides('test.tenax@tenaxgrupa.lv')?.jobTitleEn ?? null).toBeNull();
    const exported = (await app.inject({ url: '/api/admin/missing.csv', headers: TENAPORS_EDITOR })).body;
    expect(exported).not.toContain('test.tenax@');
  });

  it('rejects files it can’t read', async () => {
    expect((await post('email;name\n')).json().error).toMatch(/No columns/);
    expect((await post('name,jobTitleEn\n')).json().error).toMatch(/upn/);
    expect((await post('upn,jobTitleEn\na@b.lv,"open\n')).statusCode).toBe(400);
  });
});
