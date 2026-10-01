import fs from 'node:fs';
import crypto from 'node:crypto';
import { ConfidentialClientApplication } from '@azure/msal-node';
import type { DirectoryGroup, DirectoryUser } from '../types.js';

/** Read-only view of Entra ID. The service never writes to the directory. */
export interface Directory {
  readonly mode: 'mock' | 'graph';
  getUserById(idOrUpn: string): Promise<DirectoryUser | null>;
  /** Transitive group object IDs for a user. */
  getUserGroupIds(userId: string): Promise<string[]>;
  /** Licensed users (for the admin list / report). */
  listUsers(): Promise<DirectoryUser[]>;
  /** Transitive user members of a group (IDs). Used to resolve companies in bulk. */
  getGroupMemberIds(groupId: string): Promise<string[]>;
  searchGroups(query: string): Promise<DirectoryGroup[]>;
  /** Cheap call proving credentials + permissions work. */
  testConnection(): Promise<{ ok: true; detail: string }>;
}

const USER_SELECT = 'id,userPrincipalName,mail,displayName,jobTitle,mobilePhone,businessPhones,department,userType,accountEnabled';

// ───────────────────────────── Mock (fixtures/users.json) ─────────────────────────────

interface Fixture {
  groups: DirectoryGroup[];
  users: (DirectoryUser & { groups: string[] })[];
  overrides?: any[];
}

export class MockDirectory implements Directory {
  readonly mode = 'mock' as const;
  private data: Fixture;

  constructor(fixturesPath: string) {
    this.data = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  }

  get fixtureOverrides() {
    return this.data.overrides ?? [];
  }

  async getUserById(idOrUpn: string) {
    const k = idOrUpn.toLowerCase();
    const u = this.data.users.find((x) => x.id === k || x.userPrincipalName.toLowerCase() === k);
    return u ? strip(u) : null;
  }
  async getUserGroupIds(userId: string) {
    return this.data.users.find((u) => u.id === userId)?.groups ?? [];
  }
  async listUsers() {
    return this.data.users.map(strip);
  }
  async getGroupMemberIds(groupId: string) {
    return this.data.users.filter((u) => u.groups.includes(groupId)).map((u) => u.id);
  }
  async searchGroups(query: string) {
    const q = query.toLowerCase();
    return this.data.groups.filter((g) => g.displayName.toLowerCase().includes(q));
  }
  async testConnection() {
    return { ok: true as const, detail: `Demo data: ${this.data.users.length} users, ${this.data.groups.length} groups` };
  }
}

function strip(u: DirectoryUser & { groups?: string[] }): DirectoryUser {
  const { groups: _g, ...rest } = u;
  return { ...rest, businessPhones: rest.businessPhones ?? [] };
}

// ───────────────────────────── Microsoft Graph (app-only) ─────────────────────────────

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret?: string;
  certificatePem?: string;
  privateKeyPem?: string;
  /** Overridable for tests / sovereign clouds. */
  graphBase?: string;
  authorityHost?: string;
}

export class GraphDirectory implements Directory {
  readonly mode = 'graph' as const;
  private cca: ConfidentialClientApplication;
  private base: string;

  constructor(cfg: GraphConfig) {
    if (!cfg.tenantId || !cfg.clientId) throw new Error('Tenant ID and client ID are required');
    const auth: any = {
      clientId: cfg.clientId,
      authority: `${cfg.authorityHost ?? 'https://login.microsoftonline.com'}/${cfg.tenantId}`,
    };
    if (cfg.privateKeyPem && cfg.certificatePem) {
      auth.clientCertificate = {
        thumbprintSha256: certThumbprintSha256(cfg.certificatePem),
        privateKey: cfg.privateKeyPem,
        x5c: cfg.certificatePem,
      };
    } else if (cfg.clientSecret) {
      auth.clientSecret = cfg.clientSecret;
    } else {
      throw new Error('A certificate (recommended) or client secret is required');
    }
    this.cca = new ConfidentialClientApplication({ auth });
    this.base = cfg.graphBase ?? 'https://graph.microsoft.com/v1.0';
  }

  private async token(fresh = false): Promise<string> {
    const r = await this.cca.acquireTokenByClientCredential({ scopes: ['https://graph.microsoft.com/.default'], skipCache: fresh });
    if (!r?.accessToken) throw new Error('Could not acquire a Graph token');
    return r.accessToken;
  }

  private async get<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
    const full = url.startsWith('http') ? url : this.base + url;
    const res = await fetch(full, {
      headers: { Authorization: `Bearer ${await this.token()}`, Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 404) throw Object.assign(new Error('Not found'), { status: 404 });
    if (!res.ok) {
      const body = await res.text();
      throw Object.assign(new Error(`Graph ${res.status}: ${body.slice(0, 300)}`), { status: res.status });
    }
    return (await res.json()) as T;
  }

  private async getAll<T>(url: string, headers: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    let next: string | undefined = url;
    while (next) {
      const page: { value: T[]; '@odata.nextLink'?: string } = await this.get(next, headers);
      out.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return out;
  }

  async getUserById(idOrUpn: string) {
    try {
      return withMailboxFlag(await this.get<GraphUser>(`/users/${encodeURIComponent(idOrUpn)}?$select=${USER_SELECT},assignedPlans`));
    } catch (e: any) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async getUserGroupIds(userId: string) {
    const groups = await this.getAll<{ id: string }>(
      `/users/${encodeURIComponent(userId)}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName&$top=999`,
    );
    return groups.map((g) => g.id);
  }

  async listUsers() {
    // Licensed, enabled members only. Advanced query → needs ConsistencyLevel + $count.
    // "Licensed" in Entra includes free licences (Power BI, Teams Exploratory, Fabric…), so we also require an
    // active Exchange Online plan: no mailbox, no signature.
    const users = await this.getAll<GraphUser>(
      `/users?$select=${USER_SELECT},assignedPlans&$filter=assignedLicenses/$count ne 0 and accountEnabled eq true and userType eq 'Member'&$count=true&$top=999`,
      { ConsistencyLevel: 'eventual' },
    );
    return users.map(withMailboxFlag).filter((u) => u.hasMailbox);
  }

  async getGroupMemberIds(groupId: string) {
    const members = await this.getAll<{ id: string }>(
      `/groups/${encodeURIComponent(groupId)}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`,
    );
    return members.map((m) => m.id);
  }

  async searchGroups(query: string) {
    const q = query.replace(/"/g, '');
    const res = await this.get<{ value: DirectoryGroup[] }>(
      `/groups?$search="displayName:${encodeURIComponent(q)}"&$select=id,displayName&$top=25`,
      { ConsistencyLevel: 'eventual' },
    );
    return res.value;
  }

  /**
   * Proves the credential works AND explains exactly what's wrong when it doesn't: a fresh token is
   * decoded (diagnostics only, not trusted for anything) to check its tenant, app and application roles
   * before calling Graph, and Graph's own error code is passed through.
   */
  async testConnection() {
    const token = await this.token(true);
    const claims = decodeJwtPayload(token);
    const roles: string[] = Array.isArray(claims.roles) ? claims.roles : [];
    const has = (...any: string[]) => any.some((r) => roles.includes(r));
    const missing = [
      !has('User.Read.All', 'Directory.Read.All') && 'User.Read.All',
      !has('GroupMember.Read.All', 'Group.Read.All', 'Directory.Read.All') && 'GroupMember.Read.All',
    ].filter(Boolean) as string[];
    if (missing.length) {
      throw new GraphDiagnosticError(
        `Signed in as the app, but its token has ${roles.length ? `only these application permissions: ${roles.join(', ')}` : 'no application permissions at all'}. ` +
          `Missing: ${missing.join(', ')}. In Entra › App registrations › ${claims.app_displayname ?? 'the app'} › API permissions, add them as ` +
          `Microsoft Graph › Application permissions (not Delegated), then Grant admin consent. The Type column must say "Application". ` +
          `If they already do, wait 5 minutes for the consent to propagate and test again.`,
      );
    }
    const probe = async (label: string, url: string) => {
      try {
        return await this.get<{ value: unknown[] }>(url);
      } catch (e: any) {
        throw new GraphDiagnosticError(`Token has ${roles.join(', ')}, but Graph refused "${label}" (${e.message.slice(0, 300)}).`);
      }
    };
    const users = await probe('list users', '/users?$top=1&$select=id');
    await probe('list groups', '/groups?$top=1&$select=id');
    return {
      ok: true as const,
      detail: `Connected. Application permissions: ${roles.join(', ')}. Read access to users and groups confirmed (${users.value.length} sample user).`,
    };
  }
}

export class GraphDiagnosticError extends Error {}

function decodeJwtPayload(token: string): Record<string, any> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

type GraphUser = DirectoryUser & { assignedPlans?: { service?: string; capabilityStatus?: string }[] };

/** Adds hasMailbox (an enabled Exchange plan) and drops the bulky plan list before caching. */
export function withMailboxFlag(u: GraphUser): DirectoryUser {
  const { assignedPlans, ...rest } = u;
  return {
    ...rest,
    hasMailbox: (assignedPlans ?? []).some((p) => p.service?.toLowerCase() === 'exchange' && p.capabilityStatus === 'Enabled'),
  };
}

export function certThumbprintSha256(certPem: string): string {
  return new crypto.X509Certificate(certPem).fingerprint256.replace(/:/g, '');
}

/** Split a PEM bundle into its certificate and private key parts. */
export function splitPem(pem: string): { certificatePem?: string; privateKeyPem?: string } {
  const cert = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)?.[0];
  const key = pem.match(/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC )?PRIVATE KEY-----/)?.[0];
  return { certificatePem: cert, privateKeyPem: key };
}
