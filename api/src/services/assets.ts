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
