import { LRUCache } from 'lru-cache';
import type { Repository } from '../db/repository.js';
import type {
  Company,
  CompanySource,
  DirectoryUser,
  FieldSource,
  Overrides,
  ResolvedUser,
  Settings,
} from '../types.js';
import type { Directory } from './directory.js';
import { normalizePhone } from './phone.js';
import { ref, resolveDesign } from './designs.js';

const USER_TTL = 10 * 60_000;
const GROUP_TTL = 30 * 60_000;

/** Fields reported as "missing" when neither an override nor Entra supplies them. */
const REPORTED_FIELDS = ['displayName', 'jobTitleLv', 'mobilePhone', 'officePhone', 'email', 'department'] as const;

export interface CompanyResolution {
  company: string;
  source: CompanySource;
  candidates: string[];
  conflict: boolean;
}

/**
 * Pure company resolution: an IT administrator's company choice for this person wins (people in two company groups
 * who should only use one); otherwise match by group object ID with priority on conflict; otherwise defaultCompany.
 */
export function resolveCompany(
  groupIds: string[],
  companies: Company[],
  override: string | null | undefined,
  defaultCompany: string,
): CompanyResolution {
  const ids = new Set(groupIds.map((g) => g.toLowerCase()));
  const matched = companies
    .filter((c) => c.groupId && ids.has(c.groupId.toLowerCase()))
    .sort((a, b) => a.priority - b.priority);
  const candidates = matched.map((c) => c.key);
  const knownOverride = override && companies.some((c) => c.key === override) ? override : null;

  // An explicit choice settles any multi-group overlap, so it's not reported as a conflict.
  if (knownOverride) return { company: knownOverride, source: 'override', candidates, conflict: false };
  if (matched.length >= 1) {
    return { company: matched[0].key, source: 'group', candidates, conflict: matched.length > 1 };
  }
  return { company: defaultCompany, source: 'default', candidates, conflict: false };
}

function pick<T>(override: T | null | undefined, entra: T | null | undefined): [T | null, FieldSource] {
  if (override != null && override !== '') return [override, 'override'];
  if (entra != null && entra !== '') return [entra, 'entra'];
  return [null, 'none'];
}

/** Pure field precedence (brief §4): admin override > Entra > omit. */
export function resolveFields(entra: DirectoryUser, o: Overrides | null) {
  const sources: Record<string, FieldSource> = {};
  const f = (name: string, ov: any, en: any) => {
    const [v, s] = pick(typeof ov === 'string' ? ov.trim() : ov, typeof en === 'string' ? en.trim() : en);
    sources[name] = s;
    return v;
  };
  const fields = {
    displayName: f('displayName', o?.displayName, entra.displayName),
    jobTitleLv: f('jobTitleLv', o?.jobTitleLv, entra.jobTitle),
    jobTitleEn: f('jobTitleEn', o?.jobTitleEn, null),
    mobilePhone: normalizePhone(f('mobilePhone', o?.mobilePhone, entra.mobilePhone)),
    officePhone: normalizePhone(f('officePhone', o?.officePhone, entra.businessPhones?.[0])),
    email: f('email', null, entra.mail ?? entra.userPrincipalName),
    department: f('department', o?.department, entra.department),
    hideMobile: o?.hideMobile === true,
  };
  sources.hideMobile = o?.hideMobile != null ? 'override' : 'none';
  const missing = REPORTED_FIELDS.filter((k) => fields[k] == null);
  return { fields, sources, missing: [...missing] };
}

export class UserResolver {
  private users = new LRUCache<string, DirectoryUser>({ max: 5000, ttl: USER_TTL });
  private groups = new LRUCache<string, string[]>({ max: 5000, ttl: GROUP_TTL });
  private membership = new LRUCache<string, Map<string, string[]>>({ max: 1, ttl: GROUP_TTL });

  constructor(
    private repo: Repository,
    private getDirectory: () => Directory,
    private getSettings: () => Settings,
  ) {}

  clearCache() {
    this.users.clear();
    this.groups.clear();
    this.membership.clear();
  }

  async directoryUser(idOrUpn: string): Promise<DirectoryUser | null> {
    const key = idOrUpn.toLowerCase();
    const hit = this.users.get(key);
    if (hit) return hit;
    const u = await this.getDirectory().getUserById(idOrUpn);
    if (u) {
      this.users.set(key, u);
      this.users.set(u.id.toLowerCase(), u);
      this.users.set(u.userPrincipalName.toLowerCase(), u);
    }
    return u;
  }

  async groupIds(userId: string): Promise<string[]> {
    const hit = this.groups.get(userId);
    if (hit) return hit;
    const ids = await this.getDirectory().getUserGroupIds(userId);
    this.groups.set(userId, ids);
    return ids;
  }

  /** Resolve one user end to end. */
  async resolve(idOrUpn: string): Promise<ResolvedUser | null> {
    const entra = await this.directoryUser(idOrUpn);
    if (!entra) return null;
    const groupIds = await this.groupIds(entra.id);
    return this.build(entra, groupIds);
  }

  /** overridesOverride: preview unsaved corrections without storing them. */
  build(entra: DirectoryUser, groupIds: string[], overridesOverride?: Overrides): ResolvedUser {
    const settings = this.getSettings();
    const companies = this.repo.listCompanies();
    const overrides = overridesOverride ?? this.repo.getOverrides(entra.userPrincipalName);
    const c = resolveCompany(groupIds, companies, overrides?.company, settings.defaultCompany);
    const { fields, sources, missing } = resolveFields(entra, overrides);
    const d = resolveDesign(this.repo, c.company, overrides);
    sources.company = c.source === 'override' ? 'override' : c.source === 'group' ? 'entra' : 'none';
    const lowered = new Set(groupIds.map((g) => g.toLowerCase()));
    return {
      upn: entra.userPrincipalName.toLowerCase(),
      oid: entra.id,
      company: c.company,
      companySource: c.source,
      companyCandidates: c.candidates,
      groupIds,
      conflict: c.conflict,
      fields,
      sources,
      entra,
      overrides,
      missing,
      isAdmin: !!settings.adminGroupId && lowered.has(settings.adminGroupId.toLowerCase()),
      editorOf: companies.filter((co) => co.editorGroupId && lowered.has(co.editorGroupId.toLowerCase())).map((co) => co.key),
      design: { ...ref(d.design), source: d.source },
      allowedDesigns: d.allowed.map(ref),
      designLocked: d.locked,
      excluded: (() => {
        if (settings.excludeGroupId && lowered.has(settings.excludeGroupId.toLowerCase())) return { by: 'group' as const };
        const x = this.repo.getExclusion(entra.userPrincipalName);
        return x ? { by: 'manual' as const, reason: x.reason, excludedBy: x.excludedBy, excludedAt: x.excludedAt } : null;
      })(),
      isPilot: !!settings.pilotGroupId && lowered.has(settings.pilotGroupId.toLowerCase()),
    };
  }

  /**
   * All licensed users, resolved. Group membership is loaded per company group (N calls) rather
   * than per user, which keeps a full report to a handful of Graph requests.
   */
  async resolveAll(): Promise<ResolvedUser[]> {
    const dir = this.getDirectory();
    const settings = this.getSettings();
    let map = this.membership.get('all');
    if (!map) {
      map = new Map();
      const groupIds = [
        ...this.repo.listCompanies().flatMap((c) => [c.groupId, c.editorGroupId ?? '']),
        settings.adminGroupId,
        settings.pilotGroupId,
        settings.excludeGroupId,
      ].filter(Boolean);
      for (const gid of new Set(groupIds)) {
        let members: string[] = [];
        try {
          members = await dir.getGroupMemberIds(gid);
        } catch (e: any) {
          if (e.status !== 404) throw e; // a mistyped group ID shouldn't break the whole report
        }
        for (const uid of members) map.set(uid, [...(map.get(uid) ?? []), gid]);
      }
      this.membership.set('all', map);
    }
    const users = await dir.listUsers();
    return users.map((u) => this.build(u, map!.get(u.id) ?? []));
  }
}
