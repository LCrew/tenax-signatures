import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import type { ResolvedUser } from '../types.js';
import { AuthError, validateEntraToken } from './entra.js';
import { SESSION_COOKIE, hashSessionId } from './local.js';

export type Identity =
  | { kind: 'entra'; oid: string; upn: string; scopes: string[] }
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
        req.identity = { kind: 'entra', oid: id.oid, upn: id.upn, scopes: id.scopes };
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

  // Cookie-authenticated state changes must come from our own origin (CSRF defence on top of SameSite=Strict).
  app.addHook('preHandler', async (req, reply) => {
    if (req.identity?.kind !== 'local') return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && !sameOrigin(origin, req, ctx)) {
      return reply.code(403).send({ error: 'Cross-origin request rejected' });
    }
  });
}

function sameOrigin(origin: string, req: FastifyRequest, ctx: AppContext): boolean {
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  try {
    const o = new URL(origin);
    if (o.host === host) return true;
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
