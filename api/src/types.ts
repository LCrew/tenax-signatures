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
}

export interface SharedMailbox {
  email: string;
  company: string;
  displayName: string;
  officePhone: string | null;
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
  isAdmin: boolean;
  isPilot: boolean;
}

export interface Settings {
  publicUrl: string;
  directoryMode: DirectoryMode;
  tenantId: string;
  clientId: string;
  /** Application ID URI, e.g. api://sig.tenaxgrupa.lv/<clientId> */
  appIdUri: string;
  credentialType: 'certificate' | 'secret' | 'none';
  certificateThumbprint: string;
  defaultCompany: string;
  adminGroupId: string;
  adminGroupName: string;
  pilotGroupId: string;
  pilotGroupName: string;
  selfServiceEnabled: boolean;
  selfServiceFields: OverridableField[];
  language: SignatureLanguage;
  allowedOrigins: string[];
  addinId: string;
  setupComplete: boolean;
  /** Setup wizard progress so a reload resumes on the same step. */
  setupStep: number;
}
