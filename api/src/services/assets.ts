import fs from 'node:fs';
import path from 'node:path';
import type { Env } from '../env.js';

/** Logos and banners: uploaded (DATA_DIR/assets) wins over bundled (assets/). Null for anything else. */
export function findAsset(env: Pick<Env, 'dataDir' | 'assetsDir'>, company: string, file: string): string | null {
  if (!/^[a-z0-9-]+$/.test(company) || !/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|gif)$/i.test(file)) return null;
  for (const base of [path.join(env.dataDir, 'assets'), env.assetsDir]) {
    const full = path.join(base, company, file);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

export function imageContentType(file: string): string {
  const f = file.toLowerCase();
  return f.endsWith('.png') ? 'image/png' : f.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
}

export interface ImageSize {
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Pixel size from a PNG, GIF or JPEG header; null for anything else. */
export function imageSize(buf: Buffer): ImageSize | null {
  const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return size(buf.readUInt32BE(16), buf.readUInt32BE(20));
  if (buf.length >= 10 && buf.subarray(0, 3).toString('ascii') === 'GIF') return size(buf.readUInt16LE(6), buf.readUInt16LE(8));
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  // JPEG: walk the segments to the frame header (SOF0–SOF15; C4, C8 and CC are other segments).
  let i = 2;
  while (i + 9 <= buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) i += 1; // fill byte
    else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return size(buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5));
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) i += 2; // markers without a length
    else i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const sizes = new Map<string, { stamp: string; size: ImageSize | null }>();

/** Pixel size of a company's logo or banner, read once until the file changes; null if it's missing or unreadable. */
export function assetSize(env: Pick<Env, 'dataDir' | 'assetsDir'>, company: string, file: string): ImageSize | null {
  const full = findAsset(env, company, file);
  if (!full) return null;
  try {
    const st = fs.statSync(full);
    const stamp = `${st.mtimeMs}:${st.size}`;
    const hit = sizes.get(full);
    if (hit?.stamp === stamp) return hit.size;
    const size = imageSize(fs.readFileSync(full));
    sizes.set(full, { stamp, size });
    return size;
  } catch {
    return null;
  }
}

/**
 * Promo banners always go out at the picture's own proportions: in each <img> of a company banner
 * (<publicUrl>/assets/<company>/banner-*), the height attribute is worked out from its width and the file itself.
 * Outlook for Windows draws images at these attributes (it ignores height:auto), so a saved height that's out of step
 * with the width would stretch the banner.
 */
export function keepBannerProportions(html: string, publicUrl: string, sizeOf: (company: string, file: string) => ImageSize | null): string {
  const prefix = `${publicUrl.replace(/\/+$/, '')}/assets/`;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc=(["'])([^"']*)\1/i.exec(tag)?.[2];
    const file = src?.startsWith(prefix) ? /^([a-z0-9-]+)\/(banner-[a-z0-9._-]+)$/i.exec(src.slice(prefix.length)) : null;
    const width = /\swidth=(["'])(\d+)\1/i.exec(tag)?.[2];
    const size = file && width ? sizeOf(file[1], file[2]) : null;
    if (!size) return tag;
    const height = Math.max(1, Math.round((Number(width) * size.height) / size.width));
    return tag.replace(/(\sheight=)(["'])\d+\2/i, (_, attr: string, q: string) => `${attr}${q}${height}${q}`);
  });
}
