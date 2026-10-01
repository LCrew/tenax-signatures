import type { Company, Overrides, SharedMailbox, TemplateKind } from '../types.js';

export interface TemplateVersion {
  id: number;
  company: string;
  kind: TemplateKind;
  version: number;
  content: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  before: unknown;
  after: unknown;
}

export interface LocalAdmin {
  id: number;
  username: string;
  passwordHash: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface Exclusion {
  upn: string;
  reason: string | null;
  excludedBy: string;
  excludedAt: string;
}

export interface Session {
  id: string;
  adminId: number;
  expiresAt: number;
}

export interface TelemetryEvent {
  id: number;
  at: string;
  upn: string | null;
  event: string;
  stage: string | null;
  message: string | null;
  host: string | null;
  platform: string | null;
}

/**
 * Storage boundary. The SQLite implementation lives in sqlite.ts; a Postgres implementation only
 * needs to satisfy this interface (all methods are synchronous-compatible via Promise-free API
 * today; wrap in async if a networked DB is introduced).
 */
export interface Repository {
  // settings (key/value JSON, secrets stored encrypted by the caller)
  getSetting<T>(key: string): T | undefined;
  setSetting(key: string, value: unknown): void;

  listCompanies(): Company[];
  upsertCompany(c: Company): void;
  deleteCompany(key: string): void;

  listSharedMailboxes(): SharedMailbox[];
  getSharedMailbox(email: string): SharedMailbox | undefined;
  upsertSharedMailbox(m: SharedMailbox): void;
  deleteSharedMailbox(email: string): void;

  getOverrides(upn: string): Overrides | null;
  listOverrides(): Overrides[];
  saveOverrides(o: Overrides): void;

  latestTemplate(company: string, kind: TemplateKind): TemplateVersion | undefined;
  getTemplateVersion(id: number): TemplateVersion | undefined;
  listTemplateVersions(company: string, kind?: TemplateKind): TemplateVersion[];
  addTemplateVersion(t: Omit<TemplateVersion, 'id' | 'version' | 'createdAt'>): TemplateVersion;

  audit(actor: string, action: string, target: string, before: unknown, after: unknown): void;
  listAudit(limit: number, target?: string): AuditEntry[];

  countAdmins(): number;
  getAdminByUsername(username: string): LocalAdmin | undefined;
  getAdminById(id: number): LocalAdmin | undefined;
  listAdmins(): LocalAdmin[];
  createAdmin(username: string, passwordHash: string): LocalAdmin;
  getExclusion(upn: string): Exclusion | undefined;
  setExclusion(upn: string, reason: string | null, by: string): void;
  removeExclusion(upn: string): void;

  /** Atomically creates the first admin; null if any admin already exists. */
  createFirstAdmin(username: string, passwordHash: string): LocalAdmin | null;
  deleteSessionsForAdminExcept(adminId: number, keepSessionId: string): void;
  updateAdminPassword(id: number, passwordHash: string): void;
  deleteAdmin(id: number): void;
  touchAdminLogin(id: number): void;

  createSession(s: Session): void;
  getSession(id: string): Session | undefined;
  deleteSession(id: string): void;
  deleteSessionsForAdmin(adminId: number): void;
  purgeExpiredSessions(now: number): void;

  addTelemetry(e: Omit<TelemetryEvent, 'id' | 'at'>): void;
  listTelemetry(limit: number): TelemetryEvent[];
}
