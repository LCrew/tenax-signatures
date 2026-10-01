import { z } from 'zod';
import type { Repository } from '../db/repository.js';
import type { Design, MetaOverrides, Overrides } from '../types.js';

/**
 * Several designs per company (e.g. Standard, English, Service). Which one a person gets:
 *   1. a design an admin/editor assigned AND locked,
 *   2. otherwise the person's own choice (selectable person designs only),
 *   3. otherwise a design an admin/editor assigned (unlocked: the person may change it),
 *   4. otherwise the company default.
 * Designs from another company (e.g. after the person moved) or deleted designs are ignored.
 */

export type DesignSource = 'locked' | 'chosen' | 'assigned' | 'default';

export interface DesignRef {
  id: string;
  name: string;
  purpose: Design['purpose'];
}

export interface DesignResolution {
  design: Design;
  source: DesignSource;
  locked: boolean;
  /** What the person may switch to in Outlook / choose in My signature. */
  allowed: Design[];
}

export const ref = (d: Design): DesignRef => ({ id: d.id, name: d.name, purpose: d.purpose });

export function standardDesign(company: string): Design {
  return {
    id: `${company}-standard`,
    company,
    name: 'Standard',
    purpose: 'person',
    selectable: true,
    isDefault: true,
    sort: 0,
    metaOverrides: {},
    createdAt: new Date().toISOString(),
  };
}

/** Every company needs a default design (seeding, new companies, upgrades). */
export function ensureDefaultDesign(repo: Repository, company: string): Design {
  const designs = repo.listDesigns(company);
  const def = designs.find((d) => d.isDefault);
  if (def) return def;
  const existing = designs.find((d) => d.purpose === 'person');
  const d = existing ? { ...existing, isDefault: true } : standardDesign(company);
  repo.upsertDesign(d);
  return d;
}

export function resolveDesign(repo: Repository, company: string, o: Overrides | null): DesignResolution {
  const designs = repo.listDesigns(company);
  const def = designs.find((d) => d.isDefault) ?? designs[0] ?? standardDesign(company);
  const byId = (id?: string | null) => (id ? designs.find((d) => d.id === id) : undefined);
  const assigned = byId(o?.design);
  const chosen = byId(o?.chosenDesign);
  const selectable = designs.filter((d) => d.purpose === 'person' && d.selectable);

  let design = def;
  let source: DesignSource = 'default';
  if (assigned && o?.designLocked) [design, source] = [assigned, 'locked'];
  else if (chosen && chosen.purpose === 'person' && chosen.selectable) [design, source] = [chosen, 'chosen'];
  else if (assigned) [design, source] = [assigned, 'assigned'];

  const locked = source === 'locked';
  const allowed = locked ? [design] : unique([...selectable, ...(assigned ? [assigned] : []), design]);
  return { design, source, locked, allowed };
}

function unique(ds: Design[]): Design[] {
  const seen = new Set<string>();
  return ds.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}

/** Only these brand settings can differ per design; everything else (logo, colours, address…) is company-wide. */
export const metaOverridesSchema = z
  .object({
    greeting: z.string().max(200).optional(),
    footer: z.object({ companyLine: z.string().max(200).optional(), confidential: z.string().max(3000).optional() }).strict().optional(),
    banner: z
      .union([
        z.null(),
        z
          .object({
            file: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}\.(png|jpe?g|gif)$/i),
            width: z.number().int().min(1).max(1200),
            height: z.number().int().min(1).max(1200),
            link: z.string().max(500).optional(),
            alt: z.string().max(200).optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

/** Company brand settings (meta.json text) with a design's overrides applied; returns meta.json text. */
export function applyOverrides(metaSrc: string, o: MetaOverrides | undefined): string {
  if (!o || Object.keys(o).length === 0) return metaSrc;
  let meta: any;
  try {
    meta = JSON.parse(metaSrc);
  } catch {
    return metaSrc; // validateMeta reports it
  }
  if (!meta || typeof meta !== 'object') return metaSrc;
  const next = { ...meta, footer: { ...(meta.footer ?? {}) } };
  if (o.greeting !== undefined) next.greeting = o.greeting;
  if (o.footer?.companyLine !== undefined) next.footer.companyLine = o.footer.companyLine;
  if (o.footer?.confidential !== undefined) next.footer.confidential = o.footer.confidential;
  if (o.banner !== undefined) next.banner = o.banner;
  return JSON.stringify(next);
}

/** "English for clients" → "tenaxpanel-english-for-clients", unique within the database. */
export function newDesignId(repo: Repository, company: string, name: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'design';
  let id = `${company}-${slug}`;
  for (let i = 2; repo.getDesign(id); i++) id = `${company}-${slug}-${i}`;
  return id;
}
