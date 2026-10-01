export type ComposeType = 'newMail' | 'reply' | 'forward';
export type TemplateKind = 'new' | 'reply' | 'meta';

export interface PublicConfig {
  needsFirstAdmin: boolean;
  setupComplete: boolean;
  directoryMode: 'mock' | 'graph';
  mockAuth: boolean;
  entra: { tenantId: string; clientId: string; scope: string } | null;
}

export interface SessionInfo {
  kind: 'local' | 'entra' | 'mock';
  name: string;
  upn?: string;
  /** IT administrator: everything. */
  isAdmin: boolean;
  /** Company keys this person may edit as a signature editor. */
  editorOf?: string[];
}

export interface Company {
  key: string;
  displayName: string;
  legalName: string;
  groupName: string;
  groupId: string;
  priority: number;
  editorGroupName?: string;
  editorGroupId?: string;
}

export interface MetaOverrides {
  greeting?: string;
  footer?: { companyLine?: string; confidential?: string };
  banner?: { file: string; width: number; height: number; link?: string; alt?: string } | null;
}

export interface Design {
  id: string;
  company: string;
  name: string;
  purpose: 'person' | 'service';
  selectable: boolean;
  isDefault: boolean;
  sort: number;
  metaOverrides: MetaOverrides;
  createdAt: string;
}

export interface DesignRef {
  id: string;
  name: string;
  purpose: 'person' | 'service';
}

export interface Settings {
  publicUrl: string;
  directoryMode: 'mock' | 'graph';
  tenantId: string;
  clientId: string;
  appIdUri: string;
  credentialType: 'certificate' | 'secret' | 'none';
  certificateThumbprint: string;
  defaultCompany: string;
  adminGroupId: string;
  adminGroupName: string;
  pilotGroupId: string;
  pilotGroupName: string;
  excludeGroupId: string;
  excludeGroupName: string;
  selfServiceEnabled: boolean;
  selfServiceFields: string[];
  language: 'lv' | 'en' | 'bilingual';
  allowedOrigins: string[];
  addinId: string;
  setupComplete: boolean;
  setupStep: number;
  mockForcedByEnv: boolean;
  hasClientSecret: boolean;
  hasCertificate: boolean;
  certificateExpires: string | null;
}

export interface UserSummary {
  upn: string;
  displayName: string | null;
  jobTitle: string | null;
  company: string;
  companyName: string;
  companySource: 'group' | 'override' | 'default';
  conflict: boolean;
  candidates: string[];
  missing: string[];
  overridden: string[];
  isAdmin: boolean;
  isPilot: boolean;
  excluded?: null | { by: 'group' } | { by: 'manual'; reason: string | null; excludedBy: string; excludedAt: string };
  design?: DesignRef & { source: 'locked' | 'chosen' | 'assigned' | 'default' };
  designLocked?: boolean;
}

export interface Overrides {
  displayName?: string | null;
  jobTitleLv?: string | null;
  jobTitleEn?: string | null;
  mobilePhone?: string | null;
  officePhone?: string | null;
  department?: string | null;
  company?: string | null;
  hideMobile?: boolean | null;
  design?: string | null;
  designLocked?: boolean | null;
  chosenDesign?: string | null;
  updatedBy?: string;
  updatedAt?: string;
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

export interface UserDetail extends UserSummary {
  oid: string;
  fields: Record<string, string | boolean | null>;
  sources: Record<string, 'override' | 'entra' | 'none'>;
  entra: {
    displayName: string | null;
    jobTitle: string | null;
    mobilePhone: string | null;
    businessPhones: string[];
    department: string | null;
    mail: string | null;
  };
  overrides: Overrides | null;
  history: AuditEntry[];
}

export interface TemplateVersion {
  id: number;
  company: string;
  design?: string;
  kind: TemplateKind;
  version: number;
  content: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Report {
  total: number;
  complete: number;
  conflicts: number;
  defaulted: number;
  overridden: number;
  excluded?: number;
  byCompany: Record<string, number>;
  missingByField: Record<string, number>;
  rows: UserSummary[];
}

export interface SharedMailbox {
  email: string;
  company: string;
  displayName: string;
  officePhone: string | null;
  design?: string | null;
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

export interface LocalAccount {
  id: number;
  username: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export const FIELD_LABELS: Record<string, string> = {
  displayName: 'Name',
  jobTitleLv: 'Job title (LV)',
  jobTitleEn: 'Job title (EN)',
  mobilePhone: 'Mobile',
  officePhone: 'Office phone',
  email: 'Email',
  department: 'Department',
  company: 'Company',
  hideMobile: 'Hide mobile',
};
