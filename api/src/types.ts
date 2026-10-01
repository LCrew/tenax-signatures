export type ComposeType = 'newMail' | 'reply' | 'forward';
export type TemplateKind = 'new' | 'reply' | 'meta';
export type CompanySource = 'group' | 'override' | 'default';
export type DirectoryMode = 'mock' | 'graph';
export type SignatureLanguage = 'lv' | 'en' | 'bilingual';

export const OVERRIDABLE_FIELDS = [
  'displayName',
  'jobTitleLv',
  'jobTitleEn',
  'mobilePhone',
  'officePhone',
  'department',
  'company',
  'hideMobile',
] as const;
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];
export const SELF_SERVICE_ALLOWED: OverridableField[] = ['jobTitleEn', 'hideMobile', 'mobilePhone', 'jobTitleLv'];

export interface Company {
  key: string;
  displayName: string;
  legalName: string;
  groupName: string;
  groupId: string;
  priority: number;
  /** Members may edit this company's designs and its people's signature data, nothing else. */
  editorGroupName?: string;
  editorGroupId?: string;
}

export interface SharedMailbox {
  email: string;
  company: string;
  displayName: string;
  officePhone: string | null;
  /** Design to use (e.g. the company's Service design); null = service design if any, else default. */
  design?: string | null;
}

/** Per-design wording that may differ from the company's brand settings (e.g. an English version). */
export interface MetaOverrides {
  greeting?: string;
  footer?: { companyLine?: string; confidential?: string };
  banner?: { file: string; width: number; height: number; link?: string; alt?: string } | null;
}

export interface Design {
  id: string;
  company: string;
  name: string;
  /** person: for people; service: for service/shared accounts, assigned by admins only. */
  purpose: 'person' | 'service';
  /** People may pick it as their default in My signature / Outlook. */
  selectable: boolean;
  isDefault: boolean;
  sort: number;
  metaOverrides: MetaOverrides;
  createdAt: string;
}

/** Raw directory user as returned by Graph (subset) or fixtures. */
export interface DirectoryUser {
  id: string;
  userPrincipalName: string;
  mail: string | null;
  displayName: string | null;
  jobTitle: string | null;
  mobilePhone: string | null;
  businessPhones: string[];
  department: string | null;
  userType?: string | null;
  accountEnabled?: boolean | null;
  /** Has an active Exchange Online plan (undefined = unknown, e.g. demo data). */
  hasMailbox?: boolean;
}

export interface DirectoryGroup {
  id: string;
  displayName: string;
}

export interface Overrides {
  upn: string;
  displayName?: string | null;
  jobTitleLv?: string | null;
  jobTitleEn?: string | null;
  mobilePhone?: string | null;
  officePhone?: string | null;
  department?: string | null;
  company?: string | null;
  hideMobile?: boolean | null;
  /** Design set by an admin/editor; with designLocked the person can't change it. */
  design?: string | null;
  designLocked?: boolean | null;
  /** The person's own choice (self-service). */
  chosenDesign?: string | null;
  updatedBy?: string;
  updatedAt?: string;
}

export type FieldSource = 'override' | 'entra' | 'none';

export interface ResolvedUser {
  upn: string;
  oid: string;
  company: string;
  companySource: CompanySource;
  companyCandidates: string[];
  /** Transitive group object IDs (as resolved). */
  groupIds?: string[];
  conflict: boolean;
  fields: {
    displayName: string | null;
    jobTitleLv: string | null;
    jobTitleEn: string | null;
    mobilePhone: string | null;
    officePhone: string | null;
    email: string | null;
    department: string | null;
    hideMobile: boolean;
  };
  sources: Record<string, FieldSource>;
  entra: DirectoryUser;
  overrides: Overrides | null;
  missing: string[];
  /** IT administrators: full access. */
  isAdmin: boolean;
  /** Company keys this person may manage as a signature editor. */
  editorOf: string[];
  /** The design this person gets, and why. */
  design: { id: string; name: string; purpose: 'person' | 'service'; source: 'locked' | 'chosen' | 'assigned' | 'default' };
  /** Designs they may choose / switch to in Outlook (just the one when locked). */
  allowedDesigns: { id: string; name: string; purpose: 'person' | 'service' }[];
  designLocked: boolean;
  /** Left out of signatures and lists (service accounts etc.): via the exclusion group or by hand. */
  excluded: null | { by: 'group' } | { by: 'manual'; reason: string | null; excludedBy: string; excludedAt: string };
  isPilot: boolean;
}

export interface Settings {
  publicUrl: string;
  directoryMode: DirectoryMode;
  tenantId: string;
  clientId: string;
  /** Application ID URI, e.g. api://sig.tenax.lv/<clientId> */
  appIdUri: string;
  credentialType: 'certificate' | 'secret' | 'none';
  certificateThumbprint: string;
  defaultCompany: string;
  adminGroupId: string;
  adminGroupName: string;
  pilotGroupId: string;
  pilotGroupName: string;
  /** Members are left out of signatures and lists (service accounts, test and room mailboxes…). */
  excludeGroupId: string;
  excludeGroupName: string;
  selfServiceEnabled: boolean;
  selfServiceFields: OverridableField[];
  language: SignatureLanguage;
  allowedOrigins: string[];
  addinId: string;
  setupComplete: boolean;
  /** Setup wizard progress so a reload resumes on the same step. */
  setupStep: number;
}
