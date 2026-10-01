import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppContext } from './context.js';
import { actorOf, registerAuth } from './auth/plugin.js';
import { publicRoutes } from './routes/public.js';
import { signatureRoutes } from './routes/signature.js';
import { adminRoutes } from './routes/admin.js';
import { addinRoutes } from './routes/addin.js';
import { devRoutes } from './routes/dev.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  "connect-src 'self' https://login.microsoftonline.com",
  "frame-src 'self' https://login.microsoftonline.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export async function buildApp(ctx: AppContext, opts: { logger?: boolean | object } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? { level: ctx.env.logLevel },
    // Trust X-Forwarded-* only from the proxy hop itself (cloudflared / reverse proxy on loopback or a private
    // Docker network), never every hop: a client-supplied X-Forwarded-For can't choose req.ip any more.
    trustProxy: ctx.env.trustProxy === true ? 'loopback,linklocal,uniquelocal' : ctx.env.trustProxy,
    bodyLimit: 256 * 1024,
  });

  await app.register(cookie);
  await app.register(cors, {
    // Only the add-in host (our public URL) plus explicitly configured origins; read per request so
    // changes in the admin UI apply without a restart.
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, ctx.settings.allowedOrigins().includes(origin.replace(/\/+$/, '')));
    },
    credentials: false,
    methods: ['GET', 'PUT', 'POST', 'DELETE'],
  });

  registerAuth(app, ctx);

  // Per-user limit: runs after auth so the key is the signed-in identity, falling back to IP.
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.identity ? actorOf(req.identity) : `ip:${req.ip}`),
    // Decide on the MATCHED route, not the raw URL: "/%61pi/auth/login" routes to /api/auth/login and must be limited.
    allowList: (req) => !(req.routeOptions?.url ?? '').startsWith('/api/'),
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=15552000');
    const route = req.routeOptions?.url ?? '';
    if (route.startsWith('/api/')) {
      // Signature/preview HTML is data, never a page: if someone opens it directly, nothing in it can run.
      if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
        reply.header('Content-Security-Policy', "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; sandbox");
        reply.header('X-Frame-Options', 'DENY');
      }
    } else if (!route.startsWith('/addin/')) {
      reply.header('Content-Security-Policy', CSP);
      reply.header('X-Frame-Options', 'DENY');
    }
    return payload;
  });

  app.setErrorHandler((err: any, req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Something went wrong on the server. Check the container log.' : err.message });
  });

  publicRoutes(app, ctx);
  signatureRoutes(app, ctx);
  adminRoutes(app, ctx);
  addinRoutes(app, ctx);
  devRoutes(app, ctx);

  // Static: add-in runtime files and the admin SPA.
  if (fs.existsSync(ctx.env.addinDistDir)) {
    await app.register(fastifyStatic, { root: ctx.env.addinDistDir, prefix: '/addin/', decorateReply: false, index: false });
  }
  const spaIndex = path.join(ctx.env.adminDistDir, 'index.html');
  if (fs.existsSync(spaIndex)) {
    await app.register(fastifyStatic, { root: ctx.env.adminDistDir, prefix: '/', wildcard: false, index: false });
    // Serve SPA assets explicitly, and index.html for client-side routes.
    app.get('/*', (req, reply) => {
      // The router has already decoded the path; decoding again turned "%25" into a 500.
      const rel = String((req.params as any)['*'] ?? '');
      const full = path.join(ctx.env.adminDistDir, rel);
      if (rel && full.startsWith(ctx.env.adminDistDir + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()) {
        return reply.header('Cache-Control', rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache').sendFile(rel);
      }
      if (rel.startsWith('api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  return app;
}
