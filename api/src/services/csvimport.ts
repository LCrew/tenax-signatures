import { normalizePhone } from './phone.js';
import type { ResolvedUser } from '../types.js';

/** Columns the missing-details import fills. Format: docs/csv-import.md. */
export const IMPORT_FIELDS = ['displayName', 'jobTitleLv', 'jobTitleEn', 'mobilePhone'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const MAX_IMPORT_ROWS = 2000;

const MAX_LEN: Record<ImportField, number> = { displayName: 120, jobTitleLv: 160, jobTitleEn: 160, mobilePhone: 40 };
const PHONE_RE = /^[\d\s+()-]{5,40}$/;
const YES = new Set(['yes', 'true', '1', 'x', 'jā', 'ja']);
const NO = new Set(['', 'no', 'false', '0', 'nē', 'ne']);

export class CsvError extends Error {}

/**
 * RFC 4180-ish: quoted cells with "" escapes and line breaks, CRLF or LF, a UTF-8 BOM. The delimiter (comma,
 * semicolon as Excel writes it with Latvian regional settings, or tab) is taken from the header line.
 */
export function parseCsv(text: string): { line: number; cells: string[] }[] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const count = (ch: string) => firstLine.split(ch).length - 1;
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];

  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== '')) rows.push({ line: rowLine, cells });
    cells = [];
    cell = '';
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delim) {
      cells.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (quoted) throw new CsvError(`Line ${rowLine}: a quoted cell is never closed`);
  endRow();
  return rows;
}

/** Undo the apostrophe our CSV exports put before =, +, - and @ (spreadsheet formula guard). */
const clean = (v: string) => v.trim().replace(/^'(?=[=+\-@])/, '');

export interface ImportRow {
  line: number;
  upn: string;
  name: string | null;
  company: string | null;
  status: 'update' | 'unchanged' | 'error';
  /** What gets saved as corrections. */
  changes: Partial<Record<ImportField, string>> & { hideMobile?: true };
  /** Values that weren't used, and why. */
  notes: string[];
  error?: string;
}

export interface ImportPlan {
  rows: ImportRow[];
  ignoredColumns: string[];
  totals: { update: number; unchanged: number; error: number };
}

/**
 * Work out what a CSV would change. Only fields the person is missing are filled; a value that differs from one
 * already set is reported and left alone (corrections to existing data go through the person page).
 * `visible` = the people this admin may edit, excluded accounts left out.
 */
export function planImport(csv: string, visible: ResolvedUser[]): ImportPlan {
  const parsed = parseCsv(csv);
  if (parsed.length === 0) throw new CsvError('The file is empty');
  const [head, ...body] = parsed;
  if (body.length > MAX_IMPORT_ROWS) throw new CsvError(`Too many rows (${body.length}); at most ${MAX_IMPORT_ROWS} per file`);

  const columns = head.cells.map((c) => c.trim().toLowerCase());
  const at = (name: string) => columns.indexOf(name.toLowerCase());
  const upnCol = at('upn') >= 0 ? at('upn') : at('email');
  if (upnCol < 0) throw new CsvError('The first line must be a header with a "upn" column');
  const fieldCols = IMPORT_FIELDS.map((f) => [f, at(f)] as const).filter(([, i]) => i >= 0);
  const noMobileCol = at('noMobile');
  if (fieldCols.length === 0 && noMobileCol < 0) {
    throw new CsvError(`No columns to import. Use any of: ${[...IMPORT_FIELDS, 'noMobile'].join(', ')}`);
  }
  const known = new Set([upnCol, noMobileCol, ...fieldCols.map(([, i]) => i)]);
  const ignoredColumns = head.cells.map((c, i) => (known.has(i) || !c.trim() ? null : c.trim())).filter((c): c is string => !!c);

  const byUpn = new Map(visible.map((u) => [u.upn.toLowerCase(), u]));
  const seen = new Set<string>();
  const rows = body.map(({ line, cells }): ImportRow => {
    const cellAt = (i: number) => clean(cells[i] ?? '');
    const upn = cellAt(upnCol).toLowerCase();
    const row: ImportRow = { line, upn, name: null, company: null, status: 'unchanged', changes: {}, notes: [] };
    const fail = (error: string) => ({ ...row, status: 'error' as const, changes: {}, error });

    if (!upn) return fail('No upn');
    if (seen.has(upn)) return fail('This upn appears earlier in the file');
    seen.add(upn);
    const user = byUpn.get(upn);
    if (!user) return fail('Not found, excluded from signatures, or outside the companies you edit');
    row.name = user.fields.displayName;
    row.company = user.company;

    const noMobileRaw = noMobileCol >= 0 ? cellAt(noMobileCol).toLowerCase() : '';
    if (!YES.has(noMobileRaw) && !NO.has(noMobileRaw)) return fail(`noMobile must be yes or empty, not "${cellAt(noMobileCol)}"`);
    const noMobile = YES.has(noMobileRaw);

    for (const [field, i] of fieldCols) {
      const value = cellAt(i);
      if (!value) continue;
      if (/[\r\n]/.test(value)) return fail(`${field} contains a line break`);
      if (value.length > MAX_LEN[field]) return fail(`${field} is longer than ${MAX_LEN[field]} characters`);
      if (field === 'mobilePhone') {
        if (noMobile) return fail('Both a mobilePhone and noMobile=yes');
        if (!PHONE_RE.test(value)) return fail(`mobilePhone "${value}" may only contain digits, spaces, +, ( ) and -`);
      }
      const current = user.fields[field];
      const same = field === 'mobilePhone' ? normalizePhone(value) === current : value === current;
      if (user.missing.includes(field)) row.changes[field] = value;
      else if (!same && current != null) row.notes.push(`${field} already set to “${current}”, kept`);
      else if (!same && field === 'mobilePhone' && user.fields.hideMobile) row.notes.push('mobilePhone not used: marked as having no mobile');
    }
    if (noMobile && user.missing.includes('mobilePhone')) row.changes.hideMobile = true;
    else if (noMobile && user.fields.mobilePhone && !user.fields.hideMobile) row.notes.push(`noMobile not used: mobile already set to “${user.fields.mobilePhone}”`);

    row.status = Object.keys(row.changes).length ? 'update' : 'unchanged';
    return row;
  });

  const totals = { update: 0, unchanged: 0, error: 0 };
  for (const r of rows) totals[r.status]++;
  return { rows, ignoredColumns, totals };
}
