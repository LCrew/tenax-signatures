import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Fonts for image (SVG) signatures. Free fonts ship in assets/fonts (e.g. Poppins, OFL); commercial fonts a
 * company already licenses (Arial Nova, Myriad Pro…) are uploaded by IT into DATA_DIR/fonts and never leave the
 * server. The renderer only sees these files, never system fonts, so output is identical on every host.
 */
export interface FontInfo {
  file: string;
  source: 'bundled' | 'uploaded';
  family: string;
  style: string;
  weight: number;
  italic: boolean;
  bytes: number;
}

const FONT_RE = /^[a-z0-9][a-z0-9._ -]{0,80}\.(ttf|otf)$/i;

export class Fonts {
  private cache: { key: string; list: FontInfo[] } | null = null;

  constructor(
    private bundledDir: string,
    readonly uploadDir: string,
  ) {}

  private dirs(): [string, FontInfo['source']][] {
    return [
      [this.bundledDir, 'bundled'],
      [this.uploadDir, 'uploaded'],
    ];
  }

  list(): FontInfo[] {
    const entries: [string, FontInfo['source'], fs.Stats][] = [];
    for (const [dir, source] of this.dirs()) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) if (FONT_RE.test(f)) entries.push([path.join(dir, f), source, fs.statSync(path.join(dir, f))]);
    }
    const key = entries.map(([p, , st]) => `${p}:${st.size}:${st.mtimeMs}`).join('|');
    if (this.cache?.key === key) return this.cache.list;
    const list: FontInfo[] = [];
    for (const [p, source, st] of entries) {
      try {
        list.push({ file: path.basename(p), source, bytes: st.size, ...readFontNames(fs.readFileSync(p)) });
      } catch {
        /* unreadable font file: ignored (upload validation prevents this) */
      }
    }
    this.cache = { key, list };
    return list;
  }

  /** Absolute paths for the renderer. */
  files(): string[] {
    const out: string[] = [];
    for (const [dir] of this.dirs()) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) if (FONT_RE.test(f)) out.push(path.join(dir, f));
    }
    return out;
  }

  /** Changes whenever fonts are added/removed, so cached renders are redone with the new fonts. */
  fingerprint(): string {
    return crypto.createHash('sha256').update(this.list().map((f) => `${f.file}:${f.bytes}`).sort().join('|')).digest('hex').slice(0, 16);
  }

  /** Is there a font for this family (and roughly this weight)? */
  has(family: string, weight: number): boolean {
    const fam = family.replace(/['"]/g, '').trim().toLowerCase();
    return this.list().some((f) => f.family.toLowerCase() === fam && Math.abs(f.weight - weight) <= 100);
  }

  save(name: string, data: Buffer): FontInfo {
    if (!FONT_RE.test(name)) throw new Error('Font file name: letters, digits, dot, dash, space; .ttf or .otf');
    const magic = data.subarray(0, 4).toString('latin1');
    if (!['\0\x01\0\0', 'OTTO', 'true'].includes(magic)) throw new Error('That isn’t a TrueType (.ttf) or OpenType (.otf) font');
    const names = readFontNames(data); // throws on garbage
    fs.mkdirSync(this.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(this.uploadDir, name), data);
    this.cache = null;
    return { file: name, source: 'uploaded', bytes: data.length, ...names };
  }

  remove(name: string): boolean {
    if (!FONT_RE.test(name)) return false;
    const p = path.join(this.uploadDir, name);
    if (!fs.existsSync(p)) return false;
    fs.unlinkSync(p);
    this.cache = null;
    return true;
  }
}

/** Minimal sfnt reader: family/style from the 'name' table, weight/italic from 'OS/2'. */
export function readFontNames(buf: Buffer): { family: string; style: string; weight: number; italic: boolean } {
  if (buf.length < 12) throw new Error('Font file is too small');
  const numTables = buf.readUInt16BE(4);
  const tables: Record<string, { offset: number; length: number }> = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    if (rec + 16 > buf.length) throw new Error('Font table directory is truncated');
    tables[buf.toString('latin1', rec, rec + 4)] = { offset: buf.readUInt32BE(rec + 8), length: buf.readUInt32BE(rec + 12) };
  }
  const name = tables['name'];
  if (!name || name.offset + 6 > buf.length) throw new Error('Font has no name table');
  const count = buf.readUInt16BE(name.offset + 2);
  const strings = name.offset + buf.readUInt16BE(name.offset + 4);
  const found: Record<number, string> = {};
  for (let i = 0; i < count; i++) {
    const r = name.offset + 6 + i * 12;
    if (r + 12 > buf.length) break;
    const platform = buf.readUInt16BE(r);
    const nameId = buf.readUInt16BE(r + 6);
    const len = buf.readUInt16BE(r + 8);
    const off = strings + buf.readUInt16BE(r + 10);
    if (![1, 2, 16, 17].includes(nameId) || off + len > buf.length) continue;
    // Windows (3) names are UTF-16BE; Mac (1) names are single-byte.
    let s = '';
    if (platform === 3 || platform === 0) for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(buf.readUInt16BE(off + j));
    else if (platform === 1) s = buf.toString('latin1', off, off + len);
    if (s && (platform === 3 || !found[nameId])) found[nameId] = s;
  }
  let weight = 400;
  let italic = false;
  const os2 = tables['OS/2'];
  if (os2 && os2.offset + 64 <= buf.length) {
    weight = buf.readUInt16BE(os2.offset + 4);
    italic = (buf.readUInt16BE(os2.offset + 62) & 1) === 1;
  }
  const family = found[16] || found[1];
  if (!family) throw new Error('Font has no family name');
  return { family, style: found[17] || found[2] || 'Regular', weight, italic };
}
