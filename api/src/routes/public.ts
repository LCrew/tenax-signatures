import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  hashPassword,
  hashSessionId,
  newSessionId,
  passwordProblems,
  safeEqual,
  verifyPassword,
} from '../auth/local.js';
import { API_SCOPE } from '../auth/plugin.js';

// Constant-time-ish failure path so response time doesn't reveal whether a username exists.
const DUMMY_HASH = 'scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

export function publicRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/healthz', async () => {
    ctx.repo.countAdmins(); // proves the DB is readable
    return { status: 'ok' };
  });

  /** Bootstrap info for the SPA. Contains no secrets. */
  app.get('/api/public/config', async () => {
    const s = ctx.settings.get();
    const entraReady = s.directoryMode === 'graph' && !!s.tenantId && !!s.clientId && !!s.appIdUri;
    return {
      needsFirstAdmin: ctx.repo.countAdmins() === 0,
      setupComplete: s.setupComplete,
      directoryMode: s.directoryMode,
      mockAuth: ctx.env.mockAuthHeader,
      entra: entraReady
        ? { tenantId: s.tenantId, clientId: s.clientId, scope: `${s.appIdUri}/${API_SCOPE}` }
        : null,
    };
  });

  const loginSchema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const body = loginSchema.safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Enter a username and password' });
      const admin = ctx.repo.getAdminByUsername(body.data.username.trim());
      const ok = await verifyPassword(body.data.password, admin?.passwordHash ?? DUMMY_HASH);
      if (!admin || !ok) {
        ctx.repo.audit(`local:${body.data.username}`, 'login.failed', 'auth', null, { ip: req.ip });
        return reply.code(401).send({ error: 'Username or password is incorrect' });
      }
      startSession(ctx, reply, admin.id, req.protocol === 'https');
      ctx.repo.touchAdminLogin(admin.id);
      ctx.repo.audit(`local:${admin.username}`, 'login', 'auth', null, { ip: req.ip });
      return { username: admin.username };
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const cookie = req.cookies[SESSION_COOKIE];
    if (cookie) ctx.repo.deleteSession(hashSessionId(cookie, ctx.sessionKey));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Who am I, from the admin console's perspective. */
  app.get('/api/auth/session', async (req, reply) => {
    const id = req.identity;
    if (!id) return reply.code(401).send({ error: req.authError?.message ?? 'Not signed in' });
    if (id.kind === 'local') return { kind: 'local', name: id.username, isAdmin: true };
    const user = await ctx.resolver.resolve(id.kind === 'entra' ? id.oid : id.upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    return { kind: id.kind, name: user.fields.displayName ?? user.upn, upn: user.upn, isAdmin: user.isAdmin };
  });

  // ─── First launch ───
  const tokenSchema = z.object({ token: z.string().min(1).max(100) });
  const setupRate = { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } };

  app.post('/api/setup/verify', setupRate, async (req, reply) => {
    if (ctx.repo.countAdmins() > 0) return reply.code(409).send({ error: 'Setup has already created an admin account' });
    const body = tokenSchema.safeParse(req.body);
    if (!body.success || !ctx.setupToken || !safeEqual(normalizeToken(body.data.token), ctx.setupToken)) {
      return reply.code(403).send({ error: 'That setup code does not match. Copy it again from the container log.' });
    }
    return { ok: true };
  });

  const adminSchema = tokenSchema.extend({
    username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._@-]+$/),
    password: z.string(),
  });

  app.post('/api/setup/admin', setupRate, async (req, reply) => {
    if (ctx.repo.countAdmins() > 0) return reply.code(409).send({ error: 'Setup has already created an admin account' });
    const body = adminSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Usernames use 3–64 letters, digits, dots, dashes or @.' });
    if (!ctx.setupToken || !safeEqual(normalizeToken(body.data.token), ctx.setupToken)) {
      return reply.code(403).send({ error: 'That setup code does not match. Copy it again from the container log.' });
    }
    const problem = passwordProblems(body.data.password);
    if (problem) return reply.code(400).send({ error: problem });
    const admin = ctx.repo.createAdmin(body.data.username, await hashPassword(body.data.password));
    ctx.setupToken = null; // single use
    ctx.repo.audit(`local:${admin.username}`, 'setup.admin.created', 'auth', null, { username: admin.username });
    ctx.settings.update({ setupStep: Math.max(ctx.settings.get().setupStep, 2) });
    startSession(ctx, reply, admin.id, req.protocol === 'https');
    req.log.info(`First admin "${admin.username}" created; setup code revoked`);
    return { username: admin.username };
  });

}

function normalizeToken(t: string) {
  return t.trim().toUpperCase().replace(/\s+/g, '');
}

export function startSession(ctx: AppContext, reply: any, adminId: number, secure: boolean) {
  const sid = newSessionId();
  ctx.repo.purgeExpiredSessions(Date.now());
  ctx.repo.createSession({ id: hashSessionId(sid, ctx.sessionKey), adminId, expiresAt: Date.now() + SESSION_TTL_MS });
  reply.setCookie(SESSION_COOKIE, sid, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: SESSION_TTL_MS / 1000,
  });
}
