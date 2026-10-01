import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import type { Company, Overrides, SharedMailbox, TemplateKind } from '../types.js';
import type { AuditEntry, LocalAdmin, Repository, Session, TelemetryEvent, TemplateVersion } from './repository.js';

const MIGRATIONS: string[] = [
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
    }));
  }
  upsertCompany(c: Company) {
    this.db
      .prepare(
        `INSERT INTO companies(key, display_name, legal_name, group_name, group_id, priority) VALUES(@key, @displayName, @legalName, @groupName, @groupId, @priority)
         ON CONFLICT(key) DO UPDATE SET display_name=excluded.display_name, legal_name=excluded.legal_name,
           group_name=excluded.group_name, group_id=excluded.group_id, priority=excluded.priority`,
      )
      .run(c);
  }
  deleteCompany(key: string) {
    this.db.prepare('DELETE FROM companies WHERE key = ?').run(key);
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
        `INSERT INTO shared_mailboxes(email, company, display_name, office_phone) VALUES(@email, @company, @displayName, @officePhone)
         ON CONFLICT(email) DO UPDATE SET company=excluded.company, display_name=excluded.display_name, office_phone=excluded.office_phone`,
      )
      .run(m);
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
        `INSERT INTO signature_overrides(upn, display_name, job_title_lv, job_title_en, mobile_phone, office_phone, department, company, hide_mobile, updated_by, updated_at)
         VALUES(@upn, @displayName, @jobTitleLv, @jobTitleEn, @mobilePhone, @officePhone, @department, @company, @hideMobile, @updatedBy, @updatedAt)
         ON CONFLICT(upn) DO UPDATE SET display_name=excluded.display_name, job_title_lv=excluded.job_title_lv,
           job_title_en=excluded.job_title_en, mobile_phone=excluded.mobile_phone, office_phone=excluded.office_phone,
           department=excluded.department, company=excluded.company, hide_mobile=excluded.hide_mobile,
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
        updatedBy: o.updatedBy ?? 'system',
        updatedAt: o.updatedAt ?? now(),
      });
  }

  latestTemplate(company: string, kind: TemplateKind) {
    const r = this.db
      .prepare('SELECT * FROM templates WHERE company = ? AND kind = ? ORDER BY version DESC LIMIT 1')
      .get(company, kind);
    return r ? mapTemplate(r) : undefined;
  }
  getTemplateVersion(id: number) {
    const r = this.db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    return r ? mapTemplate(r) : undefined;
  }
  listTemplateVersions(company: string, kind?: TemplateKind) {
    const rows = kind
      ? this.db.prepare('SELECT * FROM templates WHERE company = ? AND kind = ? ORDER BY version DESC').all(company, kind)
      : this.db.prepare('SELECT * FROM templates WHERE company = ? ORDER BY kind, version DESC').all(company);
    return (rows as any[]).map(mapTemplate);
  }
  addTemplateVersion(t: Omit<TemplateVersion, 'id' | 'version' | 'createdAt'>): TemplateVersion {
    return this.db.transaction(() => {
      const prev = this.latestTemplate(t.company, t.kind);
      const version = (prev?.version ?? 0) + 1;
      const info = this.db
        .prepare(
          'INSERT INTO templates(company, kind, version, content, note, created_by, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)',
        )
        .run(t.company, t.kind, version, t.content, t.note, t.createdBy, now());
      return this.getTemplateVersion(Number(info.lastInsertRowid))!;
    })();
  }

  audit(actor: string, action: string, target: string, before: unknown, after: unknown) {
    this.db
      .prepare('INSERT INTO audit_log(at, actor, action, target, before_json, after_json) VALUES(?, ?, ?, ?, ?, ?)')
      .run(now(), actor, action, target, JSON.stringify(before ?? null), JSON.stringify(after ?? null));
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
  return { email: r.email, company: r.company, displayName: r.display_name, officePhone: r.office_phone };
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
    updatedBy: r.updated_by,
    updatedAt: r.updated_at,
  };
}
function mapTemplate(r: any): TemplateVersion {
  return {
    id: r.id,
    company: r.company,
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
