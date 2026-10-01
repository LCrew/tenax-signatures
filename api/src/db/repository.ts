import type { Company, Design, Overrides, SharedMailbox, TemplateKind } from '../types.js';

export interface TemplateVersion {
  id: number;
  company: string;
  /** Design id for new/reply; '' for the company's brand settings (meta). */
  design: string;
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

export interface RenderedImage {
  hash: string;
  company: string;
  design: string;
  /** templates.id of the image version that was rendered (old emails keep showing the old image). */
  templateId: number;
  valuesJson: string;
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

  listDesigns(company?: string): Design[];
  getDesign(id: string): Design | undefined;
  upsertDesign(d: Design): void;
  deleteDesign(id: string): void;

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

  /** design omitted = the company's default design (ignored for meta). */
  latestTemplate(company: string, kind: TemplateKind, design?: string): TemplateVersion | undefined;
  getTemplateVersion(id: number): TemplateVersion | undefined;
  listTemplateVersions(company: string, kind?: TemplateKind, design?: string): TemplateVersion[];
  addTemplateVersion(t: Omit<TemplateVersion, 'id' | 'version' | 'createdAt' | 'design'> & { design?: string }): TemplateVersion;

  audit(actor: string, action: string, target: string, before: unknown, after: unknown): void;
  listAudit(limit: number, target?: string): AuditEntry[];

  countAdmins(): number;
  getAdminByUsername(username: string): LocalAdmin | undefined;
  getAdminById(id: number): LocalAdmin | undefined;
  listAdmins(): LocalAdmin[];
  createAdmin(username: string, passwordHash: string): LocalAdmin;
  saveRenderedImage(img: RenderedImage): void;
  getRenderedImage(hash: string): RenderedImage | undefined;

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
