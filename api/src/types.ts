export type ComposeType = 'newMail' | 'reply' | 'forward';
/** wording = a design's Wording-tab overrides (JSON), versioned so restores bring them back too. */
export type TemplateKind = 'new' | 'reply' | 'meta' | 'image' | 'wording';
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
  'address',
] as const;
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];
export const SELF_SERVICE_ALLOWED: OverridableField[] = ['jobTitleEn', 'hideMobile', 'mobilePhone', 'jobTitleLv', 'address'];

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
  /**
   * What people sending from this address get:
   * mailbox: the mailbox's own signature (name above, company, design);
   * sender: the sender's personal signature, unchanged;
   * senderWithMailboxEmail: the sender's personal signature with this mailbox's address as the email line.
   */
  signature?: MailboxSignature;
}

export const MAILBOX_SIGNATURES = ['mailbox', 'sender', 'senderWithMailboxEmail'] as const;
export type MailboxSignature = (typeof MAILBOX_SIGNATURES)[number];

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
  /** html: visual designer / HTML; image: SVG template rendered to a PNG per person. */
  format?: 'html' | 'image';
  /** Job title language for this design; null/undefined = the global setting. */
  language?: SignatureLanguage | null;
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
  /** Has any licence, free ones included (undefined = unknown, e.g. demo data). */
  licensed?: boolean;
  /** Has an active Exchange Online plan (undefined = unknown, e.g. demo data). */
  hasMailbox?: boolean;
  /** Status of its Exchange Online plan: 'Enabled', else e.g. 'Deleted' (switched off) or 'Suspended'; null = none. */
  exchangeStatus?: string | null;
}

/**
 * Why the directory alone keeps an account out of signatures: guest, sign-in blocked, no licence, licences without
 * a mailbox (Power BI, Teams Exploratory…), or an Exchange Online plan that isn't active.
 */
export type SkipReason = 'guest' | 'disabled' | 'unlicensed' | 'noMailbox' | 'mailboxOff';

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
  /** Their own address line instead of the company's (Brand and footer), e.g. another office. */
  address?: string | null;
  /** Design set by an admin/editor; with designLocked the person can't change it. */
  design?: string | null;
  designLocked?: boolean | null;
  /** The person's own choice (self-service). */
  chosenDesign?: string | null;
  /** Personal closing line: null/undefined = company or design default, '' = none. */
  greeting?: string | null;
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
    /** null = use the company/design closing line; '' = no closing line. */
    greeting: string | null;
    /** Their own address line; null = the company's. */
    address: string | null;
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
  /** Left out by the directory itself (see SkipReason); empty = the account qualifies. */
  skipped: SkipReason[];
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
