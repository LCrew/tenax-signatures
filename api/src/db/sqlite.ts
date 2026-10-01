import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Company, Design, Overrides, SharedMailbox, TemplateKind } from '../types.js';
import type { AuditEntry, Exclusion, LocalAdmin, RenderedImage, Repository, Session, TelemetryEvent, TemplateVersion } from './repository.js';

export const MIGRATIONS: string[] = [
  `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE companies (
     key TEXT PRIMARY KEY, display_name TEXT NOT NULL, legal_name TEXT NOT NULL,
     group_name TEXT NOT NULL, group_id TEXT NOT NULL, priority INTEGER NOT NULL);
   CREATE TABLE shared_mailboxes (
     email TEXT PRIMARY KEY COLLATE NOCASE, company TEXT NOT NULL, display_name TEXT NOT NULL, office_phone TEXT);
   CREATE TABLE signature_overrides (
     upn TEXT PRIMARY KEY COLLATE NOCASE,
     display_name TEXT, job_title_lv TEXT, job_title_en TEXT, mobile_phone TEXT, office_phone TEXT,
     department TEXT, company TEXT, hide_mobile INTEGER,
     updated_by TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE templates (
     id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL, kind TEXT NOT NULL, version INTEGER NOT NULL,
     content TEXT NOT NULL, note TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
     UNIQUE(company, kind, version));
   CREATE TABLE audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
     target TEXT NOT NULL, before_json TEXT, after_json TEXT);
   CREATE INDEX audit_target ON audit_log(target);
   CREATE TABLE local_admins (
     id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     password_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT);
   CREATE TABLE sessions (id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL, expires_at INTEGER NOT NULL);
   CREATE TABLE telemetry (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, upn TEXT, event TEXT NOT NULL, stage TEXT,
     message TEXT, host TEXT, platform TEXT);`,
  // v2: per-company signature editors (a security group that may edit only that company).
  `ALTER TABLE companies ADD COLUMN editor_group_name TEXT NOT NULL DEFAULT '';
   ALTER TABLE companies ADD COLUMN editor_group_id TEXT NOT NULL DEFAULT '';`,
  // v3: accounts left out of signatures by hand (service accounts, room/test mailboxes…).
  `CREATE TABLE excluded_users (
     upn TEXT PRIMARY KEY COLLATE NOCASE, reason TEXT, excluded_by TEXT NOT NULL, excluded_at TEXT NOT NULL);`,
  // v4: several designs per company (Standard, English, Service…). Existing new/reply versions move to a
  // "<company>-standard" design; brand settings (meta) stay per company (design = '').
  `CREATE TABLE designs (
     id TEXT PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, purpose TEXT NOT NULL DEFAULT 'person',
     selectable INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
     meta_overrides TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
   CREATE INDEX designs_company ON designs(company);
   INSERT INTO designs(id, company, name, purpose, selectable, is_default, sort, meta_overrides, created_at)
     SELECT key || '-standard', key, 'Standard', 'person', 1, 1, 0, '{}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM companies;
   CREATE TABLE templates_v4 (
     id INTEGER PRIMARY KEY AUTOINCREMENT, company TEXT NOT NULL, design TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
     version INTEGER NOT NULL, content TEXT NOT NULL, note TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
     UNIQUE(company, design, kind, version));
   INSERT INTO templates_v4(id, company, design, kind, version, content, note, created_by, created_at)
     SELECT id, company, CASE WHEN kind = 'meta' THEN '' ELSE company || '-standard' END, kind, version, content, note, created_by, created_at
     FROM templates;
   DROP TABLE templates;
   ALTER TABLE templates_v4 RENAME TO templates;
   ALTER TABLE signature_overrides ADD COLUMN design TEXT;
   ALTER TABLE signature_overrides ADD COLUMN design_locked INTEGER;
   ALTER TABLE signature_overrides ADD COLUMN chosen_design TEXT;
   ALTER TABLE shared_mailboxes ADD COLUMN design TEXT;`,
  // v5: image (SVG) designs. format: 'html' (designer/HTML) or 'image' (SVG template → PNG). rendered_images maps
  // an opaque hash in the public image URL to exactly what was rendered (no free-form text via URLs).
  `ALTER TABLE designs ADD COLUMN format TEXT NOT NULL DEFAULT 'html';
   CREATE TABLE rendered_images (
     hash TEXT PRIMARY KEY, company TEXT NOT NULL, design TEXT NOT NULL, template_id INTEGER NOT NULL,
     values_json TEXT NOT NULL, created_at TEXT NOT NULL);`,
];

const now = () => new Date().toISOString();

export class SqliteRepository implements Repository {
  readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    const current = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  close() {
    this.db.close();
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  setSetting(key: string, value: unknown) {
    this.db
      .prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  listCompanies(): Company[] {
    return (this.db.prepare('SELECT * FROM companies ORDER BY priority, key').all() as any[]).map((r) => ({
      key: r.key,
      displayName: r.display_name,
      legalName: r.legal_name,
      groupName: r.group_name,
      groupId: r.group_id,
      priority: r.priority,
      editorGroupName: r.editor_group_name ?? '',
      editorGroupId: r.editor_group_id ?? '',
    }));
  }
  upsertCompany(c: Company) {
    this.db
      .prepare(
        `INSERT INTO companies(key, display_name, legal_name, group_name, group_id, priority, editor_group_name, editor_group_id)
         VALUES(@key, @displayName, @legalName, @groupName, @groupId, @priority, @editorGroupName, @editorGroupId)
         ON CONFLICT(key) DO UPDATE SET display_name=excluded.display_name, legal_name=excluded.legal_name,
           group_name=excluded.group_name, group_id=excluded.group_id, priority=excluded.priority,
           editor_group_name=excluded.editor_group_name, editor_group_id=excluded.editor_group_id`,
      )
      .run({ editorGroupName: '', editorGroupId: '', ...c });
  }
  deleteCompany(key: string) {
    this.db.prepare('DELETE FROM companies WHERE key = ?').run(key);
    this.db.prepare('DELETE FROM designs WHERE company = ?').run(key);
  }

  listDesigns(company?: string): Design[] {
    const rows = company
      ? this.db.prepare('SELECT * FROM designs WHERE company = ? ORDER BY is_default DESC, sort, name').all(company)
      : this.db.prepare('SELECT * FROM designs ORDER BY company, is_default DESC, sort, name').all();
    return (rows as any[]).map(mapDesign);
  }
  getDesign(id: string): Design | undefined {
    const r = this.db.prepare('SELECT * FROM designs WHERE id = ?').get(id);
    return r ? mapDesign(r) : undefined;
  }
  upsertDesign(d: Design) {
    this.db.transaction(() => {
      // Exactly one default per company.
      if (d.isDefault) this.db.prepare('UPDATE designs SET is_default = 0 WHERE company = ? AND id <> ?').run(d.company, d.id);
      this.db
        .prepare(
          `INSERT INTO designs(id, company, name, purpose, selectable, is_default, sort, meta_overrides, created_at)
           VALUES(@id, @company, @name, @purpose, @selectable, @isDefault, @sort, @metaOverrides, @createdAt)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, purpose=excluded.purpose, selectable=excluded.selectable,
             is_default=excluded.is_default, sort=excluded.sort, meta_overrides=excluded.meta_overrides`,
        )
        .run({ ...d, selectable: d.selectable ? 1 : 0, isDefault: d.isDefault ? 1 : 0, metaOverrides: JSON.stringify(d.metaOverrides ?? {}) });
      this.db.prepare('UPDATE designs SET format = ? WHERE id = ?').run(d.format ?? 'html', d.id);
    })();
  }
  deleteDesign(id: string) {
    this.db.prepare('DELETE FROM designs WHERE id = ?').run(id);
  }
  private defaultDesignId(company: string): string {
    const r = this.db.prepare('SELECT id FROM designs WHERE company = ? AND is_default = 1').get(company) as { id: string } | undefined;
    return r?.id ?? `${company}-standard`;
  }
  /** Brand settings (meta) are per company; new/reply belong to a design (default design when not given). */
  private designFor(company: string, kind: TemplateKind, design?: string): string {
    return kind === 'meta' ? '' : design ?? this.defaultDesignId(company);
  }

  listSharedMailboxes(): SharedMailbox[] {
    return (this.db.prepare('SELECT * FROM shared_mailboxes ORDER BY email').all() as any[]).map(mapMailbox);
  }
  getSharedMailbox(email: string) {
    const r = this.db.prepare('SELECT * FROM shared_mailboxes WHERE email = ?').get(email);
    return r ? mapMailbox(r) : undefined;
  }
  upsertSharedMailbox(m: SharedMailbox) {
    this.db
      .prepare(
        `INSERT INTO shared_mailboxes(email, company, display_name, office_phone, design) VALUES(@email, @company, @displayName, @officePhone, @design)
         ON CONFLICT(email) DO UPDATE SET company=excluded.company, display_name=excluded.display_name, office_phone=excluded.office_phone,
           design=excluded.design`,
      )
      .run({ design: null, ...m });
  }
  deleteSharedMailbox(email: string) {
    this.db.prepare('DELETE FROM shared_mailboxes WHERE email = ?').run(email);
  }

  getOverrides(upn: string): Overrides | null {
    const r = this.db.prepare('SELECT * FROM signature_overrides WHERE upn = ?').get(upn);
    return r ? mapOverrides(r) : null;
  }
  listOverrides(): Overrides[] {
    return (this.db.prepare('SELECT * FROM signature_overrides').all() as any[]).map(mapOverrides);
  }
  saveOverrides(o: Overrides) {
    this.db
      .prepare(
        `INSERT INTO signature_overrides(upn, display_name, job_title_lv, job_title_en, mobile_phone, office_phone, department, company, hide_mobile,
           design, design_locked, chosen_design, updated_by, updated_at)
         VALUES(@upn, @displayName, @jobTitleLv, @jobTitleEn, @mobilePhone, @officePhone, @department, @company, @hideMobile,
           @design, @designLocked, @chosenDesign, @updatedBy, @updatedAt)
         ON CONFLICT(upn) DO UPDATE SET display_name=excluded.display_name, job_title_lv=excluded.job_title_lv,
           job_title_en=excluded.job_title_en, mobile_phone=excluded.mobile_phone, office_phone=excluded.office_phone,
           department=excluded.department, company=excluded.company, hide_mobile=excluded.hide_mobile,
           design=excluded.design, design_locked=excluded.design_locked, chosen_design=excluded.chosen_design,
           updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
      )
      .run({
        upn: o.upn.toLowerCase(),
        displayName: o.displayName ?? null,
        jobTitleLv: o.jobTitleLv ?? null,
        jobTitleEn: o.jobTitleEn ?? null,
        mobilePhone: o.mobilePhone ?? null,
        officePhone: o.officePhone ?? null,
        department: o.department ?? null,
        company: o.company ?? null,
        hideMobile: o.hideMobile == null ? null : o.hideMobile ? 1 : 0,
        design: o.design ?? null,
        designLocked: o.designLocked ? 1 : null,
        chosenDesign: o.chosenDesign ?? null,
        updatedBy: o.updatedBy ?? 'system',
        updatedAt: o.updatedAt ?? now(),
      });
  }

  latestTemplate(company: string, kind: TemplateKind, design?: string) {
    const r = this.db
      .prepare('SELECT * FROM templates WHERE company = ? AND design = ? AND kind = ? ORDER BY version DESC LIMIT 1')
      .get(company, this.designFor(company, kind, design), kind);
    return r ? mapTemplate(r) : undefined;
  }
  getTemplateVersion(id: number) {
    const r = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    return r ? mapTemplate(r) : undefined;
  }
  /** Versions of one design's new/reply plus the company's brand settings (design omitted = default design). */
  listTemplateVersions(company: string, kind?: TemplateKind, design?: string) {
    const d = design ?? this.defaultDesignId(company);
    const rows = kind
      ? this.db.prepare('SELECT * FROM templates WHERE company = ? AND kind = ? AND design = ? ORDER BY version DESC').all(company, kind, this.designFor(company, kind, d))
      : this.db.prepare("SELECT * FROM templates WHERE company = ? AND (design = ? OR kind = 'meta') ORDER BY kind, version DESC").all(company, d);
    return (rows as any[]).map(mapTemplate);
  }
  addTemplateVersion(t: Omit<TemplateVersion, 'id' | 'version' | 'createdAt' | 'design'> & { design?: string }): TemplateVersion {
    return this.db.transaction(() => {
      const design = this.designFor(t.company, t.kind, t.design);
      const prev = this.latestTemplate(t.company, t.kind, design);
      const version = (prev?.version ?? 0) + 1;
      const info = this.db
        .prepare(
          'INSERT INTO templates(company, design, kind, version, content, note, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(t.company, design, t.kind, version, t.content, t.note, t.createdBy, now());
      return this.getTemplateVersion(Number(info.lastInsertRowid))!;
    })();
  }

  audit(actor: string, action: string, target: string, before: unknown, after: unknown) {
    this.db
      .prepare('INSERT INTO audit_log(at, actor, action, target, before_json, after_json) VALUES(?, ?, ?, ?, ?, ?)')
      .run(now(), actor, action, target, JSON.stringify(before ?? null), JSON.stringify(after ?? null));
    // Failed sign-ins are noise an attacker controls: keep 30 days, never let them fill the disk.
    if (action === 'login.failed') {
      this.db.prepare("DELETE FROM audit_log WHERE action = 'login.failed' AND at < ?").run(new Date(Date.now() - 30 * 86_400_000).toISOString());
    }
  }
  listAudit(limit: number, target?: string): AuditEntry[] {
    const rows = target
      ? this.db.prepare('SELECT * FROM audit_log WHERE target = ? ORDER BY id DESC LIMIT ?').all(target, limit)
      : this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
    return (rows as any[]).map((r) => ({
      id: r.id,
      at: r.at,
      actor: r.actor,
      action: r.action,
      target: r.target,
      before: JSON.parse(r.before_json ?? 'null'),
      after: JSON.parse(r.after_json ?? 'null'),
    }));
  }

  countAdmins() {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM local_admins').get() as { n: number }).n;
  }
  getAdminByUsername(username: string) {
    const r = this.db.prepare('SELECT * FROM local_admins WHERE username = ?').get(username);
    return r ? mapAdmin(r) : undefined;
  }
  getAdminById(id: number) {
    const r = this.db.prepare('SELECT * FROM local_admins WHERE id = ?').get(id);
    return r ? mapAdmin(r) : undefined;
  }
  listAdmins() {
    return (this.db.prepare('SELECT * FROM local_admins ORDER BY username').all() as any[]).map(mapAdmin);
  }
  createAdmin(username: string, passwordHash: string): LocalAdmin {
    const info = this.db
      .prepare('INSERT INTO local_admins(username, password_hash, created_at) VALUES(?, ?, ?)')
      .run(username, passwordHash, now());
    return this.getAdminById(Number(info.lastInsertRowid))!;
  }
  saveRenderedImage(img: RenderedImage) {
    this.db
      .prepare('INSERT OR IGNORE INTO rendered_images(hash, company, design, template_id, values_json, created_at) VALUES(?, ?, ?, ?, ?, ?)')
      .run(img.hash, img.company, img.design, img.templateId, img.valuesJson, now());
  }
  getRenderedImage(hash: string): RenderedImage | undefined {
    const r = this.db.prepare('SELECT * FROM rendered_images WHERE hash = ?').get(hash) as any;
    return r ? { hash: r.hash, company: r.company, design: r.design, templateId: r.template_id, valuesJson: r.values_json } : undefined;
  }

  getExclusion(upn: string): Exclusion | undefined {
    const r = this.db.prepare('SELECT * FROM excluded_users WHERE upn = ?').get(upn) as any;
    return r ? { upn: r.upn, reason: r.reason, excludedBy: r.excluded_by, excludedAt: r.excluded_at } : undefined;
  }
  setExclusion(upn: string, reason: string | null, by: string) {
    this.db
      .prepare(
        `INSERT INTO excluded_users(upn, reason, excluded_by, excluded_at) VALUES(?, ?, ?, ?)
         ON CONFLICT(upn) DO UPDATE SET reason = excluded.reason, excluded_by = excluded.excluded_by, excluded_at = excluded.excluded_at`,
      )
      .run(upn.toLowerCase(), reason, by, now());
  }
  removeExclusion(upn: string) {
    this.db.prepare('DELETE FROM excluded_users WHERE upn = ?').run(upn);
  }

  createFirstAdmin(username: string, passwordHash: string): LocalAdmin | null {
    const info = this.db
      .prepare('INSERT INTO local_admins(username, password_hash, created_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM local_admins)')
      .run(username, passwordHash, now());
    return info.changes ? this.getAdminById(Number(info.lastInsertRowid))! : null;
  }
  deleteSessionsForAdminExcept(adminId: number, keepSessionId: string) {
    this.db.prepare('DELETE FROM sessions WHERE admin_id = ? AND id <> ?').run(adminId, keepSessionId);
  }
  updateAdminPassword(id: number, passwordHash: string) {
    this.db.prepare('UPDATE local_admins SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  }
  deleteAdmin(id: number) {
    this.db.prepare('DELETE FROM local_admins WHERE id = ?').run(id);
    this.deleteSessionsForAdmin(id);
  }
  touchAdminLogin(id: number) {
    this.db.prepare('UPDATE local_admins SET last_login_at = ? WHERE id = ?').run(now(), id);
  }

  createSession(s: Session) {
    this.db.prepare('INSERT INTO sessions(id, admin_id, expires_at) VALUES(?, ?, ?)').run(s.id, s.adminId, s.expiresAt);
  }
  getSession(id: string): Session | undefined {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    return r ? { id: r.id, adminId: r.admin_id, expiresAt: r.expires_at } : undefined;
  }
  deleteSession(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }
  deleteSessionsForAdmin(adminId: number) {
    this.db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId);
  }
  purgeExpiredSessions(ts: number) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(ts);
  }

  addTelemetry(e: Omit<TelemetryEvent, 'id' | 'at'>) {
    this.db
      .prepare('INSERT INTO telemetry(at, upn, event, stage, message, host, platform) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(now(), e.upn, e.event, e.stage, e.message, e.host, e.platform);
    // Keep the table bounded; this is diagnostics, not an archive.
    this.db.prepare('DELETE FROM telemetry WHERE id <= (SELECT MAX(id) - 5000 FROM telemetry)').run();
  }
  listTelemetry(limit: number): TelemetryEvent[] {
    return this.db.prepare('SELECT * FROM telemetry ORDER BY id DESC LIMIT ?').all(limit) as TelemetryEvent[];
  }
}

function mapMailbox(r: any): SharedMailbox {
  return { email: r.email, company: r.company, displayName: r.display_name, officePhone: r.office_phone, design: r.design ?? null };
}
function mapDesign(r: any): Design {
  let metaOverrides = {};
  try {
    metaOverrides = JSON.parse(r.meta_overrides ?? '{}');
  } catch {
    /* treated as no overrides */
  }
  return {
    id: r.id,
    company: r.company,
    name: r.name,
    purpose: r.purpose === 'service' ? 'service' : 'person',
    selectable: r.selectable === 1,
    isDefault: r.is_default === 1,
    sort: r.sort,
    metaOverrides,
    format: r.format === 'image' ? 'image' : 'html',
    createdAt: r.created_at,
  };
}
function mapOverrides(r: any): Overrides {
  return {
    upn: r.upn,
    displayName: r.display_name,
    jobTitleLv: r.job_title_lv,
    jobTitleEn: r.job_title_en,
    mobilePhone: r.mobile_phone,
    officePhone: r.office_phone,
    department: r.department,
    company: r.company,
    hideMobile: r.hide_mobile == null ? null : r.hide_mobile === 1,
    design: r.design ?? null,
    designLocked: r.design_locked === 1,
    chosenDesign: r.chosen_design ?? null,
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}
function mapTemplate(r: any): TemplateVersion {
  return {
    id: r.id,
    company: r.company,
    design: r.design ?? '',
    kind: r.kind,
    version: r.version,
    content: r.content,
    note: r.note,
    createdBy: r.created_by,
    createdAt: r.created_at,
  };
}
function mapAdmin(r: any): LocalAdmin {
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };
}
