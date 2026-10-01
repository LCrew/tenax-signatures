import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Repository } from '../db/repository.js';
import type { Env } from '../env.js';
import type { Company, Settings, TemplateKind } from '../types.js';
import type { SecretBox } from './secrets.js';

const DEFAULTS: Settings = {
  publicUrl: 'https://sig.tenax.lv',
  directoryMode: 'mock',
  tenantId: '',
  clientId: '',
  appIdUri: '',
  credentialType: 'none',
  certificateThumbprint: '',
  defaultCompany: 'tenax',
  adminGroupId: '',
  adminGroupName: 'SG-Signature-Admins',
  pilotGroupId: '',
  pilotGroupName: 'SG-Signature-Pilot',
  excludeGroupId: '',
  excludeGroupName: 'SG-Signature-Excluded',
  selfServiceEnabled: false,
  selfServiceFields: ['jobTitleEn', 'hideMobile'],
  language: 'bilingual',
  allowedOrigins: [],
  addinId: '',
  setupComplete: false,
  setupStep: 0,
};

export interface GraphCredentials {
  clientSecret?: string;
  privateKeyPem?: string;
  certificatePem?: string;
}

export class SettingsService {
  constructor(
    private repo: Repository,
    private env: Env,
    private secrets: SecretBox,
  ) {}

  get(): Settings {
    const stored = this.repo.getSetting<Partial<Settings>>('settings') ?? {};
    const s: Settings = { ...DEFAULTS, ...stored };
    if (this.env.mockGraph) s.directoryMode = 'mock';
    return s;
  }

  update(patch: Partial<Settings>): Settings {
    const stored = this.repo.getSetting<Partial<Settings>>('settings') ?? {};
    const next = { ...stored, ...patch };
    if (next.publicUrl) next.publicUrl = next.publicUrl.replace(/\/+$/, '');
    this.repo.setSetting('settings', next);
    return this.get();
  }

  getCredentials(): GraphCredentials {
    const blob = this.repo.getSetting<string>('graphCredentials');
    if (!blob) return {};
    return JSON.parse(this.secrets.decrypt(blob)) as GraphCredentials;
  }

  setCredentials(c: GraphCredentials) {
    this.repo.setSetting('graphCredentials', this.secrets.encrypt(JSON.stringify(c)));
  }

  /** Effective API audience values accepted in tokens. */
  audiences(): string[] {
    const s = this.get();
    return [s.clientId, s.appIdUri].filter(Boolean);
  }

  allowedOrigins(): string[] {
    const s = this.get();
    return Array.from(new Set([s.publicUrl, ...s.allowedOrigins].filter(Boolean).map((o) => o.replace(/\/+$/, ''))));
  }
}

/**
 * First launch: import config/companies.json, shared_mailboxes.json and the on-disk templates into
 * the database. After that, the database is the source of truth and everything is edited in the UI.
 */
export function seedIfEmpty(repo: Repository, env: Env, settings: SettingsService, log: (m: string) => void) {
  if (repo.listCompanies().length === 0) {
    const file = path.join(env.configDir, 'companies.json');
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const c of cfg.companies) {
      const meta = readMeta(env, c.key);
      repo.upsertCompany({
        key: c.key,
        displayName: c.displayName ?? meta?.displayName ?? c.legalName.replace(/^SIA\s+"?|"$/g, ''),
        legalName: c.legalName,
        groupName: c.groupName,
        groupId: c.groupId,
        priority: c.priority,
        editorGroupName: c.editorGroupName ?? '',
        editorGroupId: c.editorGroupId ?? '',
      } satisfies Company);
    }
    settings.update({
      defaultCompany: cfg.defaultCompany,
      adminGroupId: cfg.groups?.admins?.groupId ?? '',
      adminGroupName: cfg.groups?.admins?.groupName ?? 'SG-Signature-Admins',
      pilotGroupId: cfg.groups?.pilot?.groupId ?? '',
      pilotGroupName: cfg.groups?.pilot?.groupName ?? 'SG-Signature-Pilot',
      selfServiceEnabled: cfg.selfService?.enabled ?? false,
      selfServiceFields: cfg.selfService?.fields ?? ['jobTitleEn', 'hideMobile'],
      addinId: crypto.randomUUID(),
      ...(env.publicUrl ? { publicUrl: env.publicUrl } : {}),
    });
    log(`Seeded ${cfg.companies.length} companies from ${file}`);
  }
  // Upgrades: companies added to config/companies.json later (e.g. Tenax Install) are imported once.
  // Keys already seeded are remembered, so a company an admin deleted doesn't come back.
  {
    const cfg = JSON.parse(fs.readFileSync(path.join(env.configDir, 'companies.json'), 'utf8'));
    const existing = repo.listCompanies();
    const seeded = new Set(repo.getSetting<string[]>('seededCompanies') ?? existing.map((c) => c.key));
    for (const c of cfg.companies) {
      if (seeded.has(c.key) || existing.some((e) => e.key === c.key)) {
        seeded.add(c.key);
        continue;
      }
      repo.upsertCompany({
        key: c.key,
        displayName: c.displayName ?? c.key,
        legalName: c.legalName,
        groupName: c.groupName,
        groupId: c.groupId,
        priority: Math.max(0, ...existing.map((e) => e.priority)) + 1,
        editorGroupName: c.editorGroupName ?? '',
        editorGroupId: c.editorGroupId ?? '',
      });
      seeded.add(c.key);
      log(`Added company "${c.key}" from ${env.configDir}/companies.json`);
    }
    repo.setSetting('seededCompanies', [...seeded]);
  }
  if (repo.listSharedMailboxes().length === 0) {
    const file = path.join(env.configDir, 'shared_mailboxes.json');
    if (fs.existsSync(file)) {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const m of cfg.sharedMailboxes ?? []) repo.upsertSharedMailbox({ officePhone: null, ...m });
    }
  }
  for (const c of repo.listCompanies()) importTemplatesFromDisk(repo, env, c.key, 'seed', true);
}

function readMeta(env: Env, company: string): any {
  const f = path.join(env.templatesDir, company, 'meta.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

const FILES: Record<TemplateKind, string> = { new: 'new.hbs', reply: 'reply.hbs', meta: 'meta.json' };

/**
 * Import templates/<company>/* as new versions when they differ from the latest DB version.
 * onlyIfMissing: used at startup so disk edits never silently override UI edits.
 */
export function importTemplatesFromDisk(
  repo: Repository,
  env: Env,
  company: string,
  actor: string,
  onlyIfMissing = false,
): number {
  let imported = 0;
  for (const kind of Object.keys(FILES) as TemplateKind[]) {
    const file = path.join(env.templatesDir, company, FILES[kind]);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const latest = repo.latestTemplate(company, kind);
    if (onlyIfMissing && latest) continue;
    if (latest?.content === content) continue;
    repo.addTemplateVersion({ company, kind, content, note: `Imported from templates/${company}/${FILES[kind]}`, createdBy: actor });
    imported++;
  }
  return imported;
}
