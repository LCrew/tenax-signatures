import { msg, t } from './i18n';

export type ComposeType = 'newMail' | 'reply' | 'forward';
export type TemplateKind = 'new' | 'reply' | 'meta' | 'image' | 'wording';

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

/** A promo banner as saved in the company's brand settings. */
export interface Banner {
  file: string;
  width: number;
  height: number;
  link?: string;
  alt?: string;
}

/** Signature languages besides Latvian, set per person (Estonian and Lithuanian colleagues). */
export type PersonLanguage = 'et' | 'lt';
/** Latvian is the company language; 'en' = designs set to English only. */
export type SignatureLocale = 'lv' | 'en' | PersonLanguage;
/** English names; translate where shown: t(LOCALE_NAMES[l]). */
export const LOCALE_NAMES: Record<SignatureLocale, string> = { lv: msg('Latvian'), en: msg('English'), et: msg('Estonian'), lt: msg('Lithuanian') };
/** Closing line used for Estonian and Lithuanian colleagues until the company sets its own. */
export const STANDARD_GREETINGS: Record<PersonLanguage, string> = { et: 'Lugupidamisega,', lt: 'Pagarbiai,' };

/** Per-language closing line and banner (meta.languages). Missing banner key = the Latvian banner; null = none. */
export type LanguageMeta = Partial<Record<'en' | PersonLanguage, { greeting?: string; banner?: Banner | null }>>;

export interface MetaOverrides {
  greeting?: string;
  footer?: { companyLine?: string; confidential?: string };
  banner?: Banner | null;
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
  format?: 'html' | 'image';
  /** Job title language for this design; null = Settings › Signature options. */
  language?: 'lv' | 'en' | 'bilingual' | null;
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
  /** Left out by the directory itself; empty = the account qualifies. */
  skipped: SkipReason[];
  /** Skipped view / person page: the address is set up under Shared mailboxes. */
  sharedMailbox?: boolean;
  design?: DesignRef & { source: 'locked' | 'chosen' | 'assigned' | 'default' };
  designLocked?: boolean;
  /** Estonian or Lithuanian signature; null = Latvian. */
  language?: PersonLanguage | null;
}

export type SkipReason = 'guest' | 'disabled' | 'unlicensed' | 'noMailbox' | 'mailboxOff';

/** Why Microsoft 365 keeps an account out of signatures, and what would change that. English; translate where shown with t(). */
export const SKIP_REASONS: Record<SkipReason, { label: string; fix: string }> = {
  guest: { label: msg('Guest account'), fix: msg('Guests from other organisations never get a signature.') },
  disabled: {
    label: msg('Sign-in blocked'),
    fix: msg('Unblock sign-in for this account in the Microsoft 365 admin center. If people only send from this address, add it under Shared mailboxes instead.'),
  },
  unlicensed: { label: msg('No licence'), fix: msg('Assign a licence that includes Exchange Online (e.g. Microsoft 365 Business Standard or Premium).') },
  noMailbox: {
    label: msg('No mailbox in its licences'),
    fix: msg('Its licences (Power BI, Teams Exploratory, Fabric…) don’t include Exchange Online. Assign one that does.'),
  },
  mailboxOff: {
    label: msg('Exchange Online off'),
    fix: msg('Its licence includes Exchange Online, but the plan isn’t active: tick Exchange Online under Licences and apps, or check the subscription hasn’t expired.'),
  },
};

export interface Overrides {
  displayName?: string | null;
  jobTitleLv?: string | null;
  jobTitleEn?: string | null;
  mobilePhone?: string | null;
  officePhone?: string | null;
  department?: string | null;
  company?: string | null;
  hideMobile?: boolean | null;
  /** Their own address line; null = the company's. */
  address?: string | null;
  /** Estonian or Lithuanian signature (own-language title + English, own closing line and banner); null = Latvian. */
  language?: PersonLanguage | null;
  design?: string | null;
  designLocked?: boolean | null;
  chosenDesign?: string | null;
  greeting?: string | null;
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
  /** The company's address line, used unless overrides.address is set. */
  defaultAddress?: string;
  fields: Record<string, string | boolean | null>;
  sources: Record<string, 'override' | 'entra' | 'none'>;
  entra: {
    displayName: string | null;
    jobTitle: string | null;
    mobilePhone: string | null;
    businessPhones: string[];
    department: string | null;
    mail: string | null;
    /** Status of its Exchange Online plan, e.g. 'Enabled', 'Deleted' (switched off), 'Suspended'; null = none. */
    exchangeStatus?: string | null;
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
  /** mailbox: the mailbox's own signature; sender: the sender's own; senderWithMailboxEmail: the sender's own with this address. */
  signature?: 'mailbox' | 'sender' | 'senderWithMailboxEmail';
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

/** English field names; translate where shown: t(FIELD_LABELS[f]). */
export const FIELD_LABELS: Record<string, string> = {
  displayName: msg('Name'),
  jobTitleLv: msg('Job title (LV)'),
  jobTitleEn: msg('Job title (EN)'),
  mobilePhone: msg('Mobile'),
  officePhone: msg('Office phone'),
  email: msg('Email'),
  department: msg('Department'),
  company: msg('Company'),
  hideMobile: msg('Hide mobile'),
  address: msg('Address'),
  language: msg('Signature language'),
};

const OWN_TITLE: Record<'lv' | PersonLanguage, string> = {
  lv: msg('Job title (Latvian)'),
  et: msg('Job title (Estonian)'),
  lt: msg('Job title (Lithuanian)'),
};

/** Label of the own-language job title field (jobTitleLv) for a person's signature language, translated. */
export const ownTitleLabel = (language: PersonLanguage | null | undefined) => t(OWN_TITLE[language ?? 'lv']);
