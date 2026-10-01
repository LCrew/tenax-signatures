import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import type { ResolvedUser } from '../types.js';
import { AuthError, validateEntraToken } from './entra.js';
import { SESSION_COOKIE, hashSessionId } from './local.js';

export type Identity =
  | { kind: 'entra'; oid: string; upn: string; scopes: string[]; clientApp: string }
  | { kind: 'local'; adminId: number; username: string }
  | { kind: 'mock'; upn: string };

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null;
    authError: AuthError | null;
  }
}

export const API_SCOPE = 'Signature.Read';
/** Office's legacy SSO (fallback path in the add-in) always requests a scope named access_as_user. */
export const ACCEPTED_SCOPES = [API_SCOPE, 'access_as_user'];

/** Label used in audit logs and rate limit keys. */
export function actorOf(id: Identity | null): string {
  if (!id) return 'anonymous';
  if (id.kind === 'local') return `local:${id.username}`;
  return id.upn;
}

/**
 * Identifies the caller from (in order) a Bearer token, the admin session cookie, or — dev only —
 * the X-Mock-User header. Doesn't reject; route guards decide what's required.
 */
export function registerAuth(app: FastifyInstance, ctx: AppContext) {
  app.decorateRequest('identity', null);
  app.decorateRequest('authError', null);

  app.addHook('onRequest', async (req) => {
    req.identity = null;
    req.authError = null;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const s = ctx.settings.get();
      try {
        const id = await validateEntraToken(auth.slice(7), {
          tenantId: s.tenantId,
          audiences: ctx.settings.audiences(),
          jwks: ctx.jwks,
        });
        req.identity = { kind: 'entra', oid: id.oid, upn: id.upn, scopes: id.scopes, clientApp: id.clientApp };
      } catch (e) {
        req.authError = e instanceof AuthError ? e : new AuthError('Invalid token');
      }
      return;
    }

    const cookie = req.cookies?.[SESSION_COOKIE];
    if (cookie) {
      const session = ctx.repo.getSession(hashSessionId(cookie, ctx.sessionKey));
      if (session && session.expiresAt > Date.now()) {
        const admin = ctx.repo.getAdminById(session.adminId);
        if (admin) {
          req.identity = { kind: 'local', adminId: admin.id, username: admin.username };
          return;
        }
      }
    }

    // Dev-only escape hatch. env.mockAuthHeader is false whenever NODE_ENV=production (see env.ts).
    const mockUser = req.headers['x-mock-user'];
    if (ctx.env.mockAuthHeader && typeof mockUser === 'string' && mockUser) {
      req.identity = { kind: 'mock', upn: mockUser.toLowerCase() };
    }
  });

  // Cookie-authenticated state changes must provably come from our own page (CSRF defence on top of
  // SameSite=Strict). Fail closed: no Origin and no Sec-Fetch-Site = rejected.
  app.addHook('preHandler', async (req, reply) => {
    if (req.identity?.kind !== 'local') return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    const fetchSite = req.headers['sec-fetch-site'];
    const ok = origin ? sameOrigin(origin, req, ctx) : fetchSite === 'same-origin';
    if (!ok) return reply.code(403).send({ error: 'Cross-origin request rejected' });
  });
}

function sameOrigin(origin: string, req: FastifyRequest, ctx: AppContext): boolean {
  try {
    const o = new URL(origin);
    // req.host honours trustProxy (no raw X-Forwarded-Host); normalise through URL so default ports compare equal.
    if (o.host === new URL(`${req.protocol}://${req.host}`).host) return true;
    return new URL(ctx.settings.get().publicUrl).origin === o.origin;
  } catch {
    return false;
  }
}

/** Resolves the signed-in *mail user* (Entra token or mock header). Local admins aren't mail users. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply, ctx: AppContext): Promise<ResolvedUser | null> {
  const id = req.identity;
  if (!id || id.kind === 'local') {
    const err = req.authError ?? new AuthError(id?.kind === 'local' ? 'This endpoint needs a Microsoft account' : 'Sign-in required');
    reply.code(err.statusCode).send({ error: err.message });
    return null;
  }
  if (id.kind === 'entra' && !id.scopes.some((s) => ACCEPTED_SCOPES.includes(s))) {
    reply.code(403).send({ error: `Missing scope ${API_SCOPE}` });
    return null;
  }
  const lookup = id.kind === 'entra' ? id.oid : id.upn;
  const user = await ctx.resolver.resolve(lookup);
  if (!user) {
    reply.code(404).send({ error: 'User not found in directory' });
    return null;
  }
  // Only enabled member accounts: guests (B2B) and disabled accounts get no signature and no console.
  if (user.entra.userType && user.entra.userType !== 'Member') {
    reply.code(403).send({ error: 'Guest accounts can’t use the signature service' });
    return null;
  }
  if (user.entra.accountEnabled === false) {
    reply.code(403).send({ error: 'This account is disabled' });
    return null;
  }
  // Cross-check: the object ID in the token must belong to the UPN in the token.
  if (id.kind === 'entra' && user.upn !== id.upn && user.entra.mail?.toLowerCase() !== id.upn) {
    req.log.warn({ oid: id.oid, tokenUpn: id.upn, dirUpn: user.upn }, 'Token UPN/oid mismatch');
    reply.code(403).send({ error: 'Token identity mismatch' });
    return null;
  }
  return user;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply, ctx: AppContext): Promise<Identity | null> {
  const id = req.identity;
  if (!id) {
    const err = req.authError ?? new AuthError('Sign-in required');
    reply.code(err.statusCode).send({ error: err.message });
    return null;
  }
  if (id.kind === 'local') return id;
  const user = await requireUser(req, reply, ctx);
  if (!user) return null;
  if (!user.isAdmin) {
    reply.code(403).send({ error: `You need to be a member of ${ctx.settings.get().adminGroupName} to use the admin console` });
    return null;
  }
  return id;
}

/**
 * Who may use the admin console, and for which companies.
 * - global: IT administrators (admins group, or a local break-glass account): everything.
 * - company editors: members of a company's editors group: that company's people and designs only.
 */
export interface Access {
  identity: Identity;
  global: boolean;
  companies: ReadonlySet<string>;
  can(company: string): boolean;
}

export async function requireStaff(req: FastifyRequest, reply: FastifyReply, ctx: AppContext): Promise<Access | null> {
  const id = req.identity;
  if (!id) {
    const err = req.authError ?? new AuthError('Sign-in required');
    reply.code(err.statusCode).send({ error: err.message });
    return null;
  }
  if (id.kind === 'local') return { identity: id, global: true, companies: new Set(), can: () => true };
  // Admin powers only via tokens issued to OUR app with our own scope (the console/add-in), not via Office's
  // legacy-SSO token (access_as_user) or any other app a user may have consented to.
  if (id.kind === 'entra' && (id.clientApp !== ctx.settings.get().clientId || !id.scopes.includes(API_SCOPE))) {
    reply.code(403).send({ error: 'Sign in to the console to use admin functions' });
    return null;
  }
  const user = await requireUser(req, reply, ctx);
  if (!user) return null;
  if (user.isAdmin) return { identity: id, global: true, companies: new Set(), can: () => true };
  if (user.editorOf.length) {
    const companies = new Set(user.editorOf);
    return { identity: id, global: false, companies, can: (c) => companies.has(c) };
  }
  reply.code(403).send({ error: 'You need to be in the IT administrators group or a company’s signature editors group' });
  return null;
}
