import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { API_SCOPE } from '../auth/plugin.js';

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Stable second add-in ID for the personal test copy, derived from the real one so it never changes and never
 * collides with the admin-deployed add-in.
 */
export function testAddinId(addinId: string): string {
  const h = crypto.createHash('sha256').update(`test:${addinId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Manifest with this deployment's host, app ID and add-in ID filled in. */
export function renderManifest(ctx: AppContext, opts: { test?: boolean } = {}): string {
  const s = ctx.settings.get();
  const file = path.join(ctx.env.addinDistDir, 'manifest.template.xml');
  const fallback = path.resolve(ctx.env.addinDistDir, '..', 'manifest.template.xml');
  const tpl = fs.readFileSync(fs.existsSync(file) ? file : fallback, 'utf8');
  const values: Record<string, string> = {
    PUBLIC_URL: s.publicUrl.replace(/\/+$/, ''),
    ADDIN_ID: opts.test ? testAddinId(s.addinId) : s.addinId,
    CLIENT_ID: s.clientId || '00000000-0000-0000-0000-000000000000',
    API_SCOPE_URI: s.appIdUri || `api://${new URL(s.publicUrl).host}/${s.clientId}`,
    VERSION: '1.1.1.0', // 1.1: Signatures button + task pane; 1.1.1: Tenax red signature icon. Bump on every manifest change.
  };
  let xml = tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? xmlEscape(values[k]) : m));
  if (opts.test) xml = xml.replace('<DisplayName DefaultValue="Tenax Signature"/>', '<DisplayName DefaultValue="Tenax Signature (test)"/>');
  return xml;
}

export function addinRoutes(app: FastifyInstance, ctx: AppContext) {
  // Classic Outlook's JS-only runtime refuses scripts not listed here.
  app.get('/.well-known/microsoft-officeaddins-allowed.json', async () => ({
    allowed: [`${ctx.settings.get().publicUrl}/addin/launchevent.js`],
  }));

  /** The bundle with runtime config prepended, so the image never needs rebuilding per tenant. */
  app.get('/addin/:script(^(?:launchevent|taskpane)$).js', async (req, reply) => {
    const file = path.join(ctx.env.addinDistDir, `${(req.params as { script: string }).script}.js`);
    if (!fs.existsSync(file)) return reply.code(404).send('// add-in bundle not built');
    const s = ctx.settings.get();
    const cfg = {
      apiBase: s.publicUrl,
      clientId: s.clientId,
      apiScope: s.appIdUri ? `${s.appIdUri}/${API_SCOPE}` : '',
      tenantId: s.tenantId,
    };
    const body = `globalThis.__SIG_CONFIG__ = ${JSON.stringify(cfg).replace(/</g, '\\u003c')};\n` + fs.readFileSync(file, 'utf8');
    return reply.type('application/javascript; charset=utf-8').header('Cache-Control', 'no-cache').send(body);
  });

  // ?variant=test: same add-in under a different ID, for installing on your own mailbox (Outlook on the web ›
  // My add-ins › Add from file) while the admin-deployed one is still propagating. Remove it afterwards.
  app.get('/addin/manifest.xml', async (req, reply) => {
    const test = (req.query as { variant?: string }).variant === 'test';
    return reply
      .type('application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${test ? 'tenax-signature-test-manifest.xml' : 'tenax-signature-manifest.xml'}"`)
      .send(renderManifest(ctx, { test }));
  });

  // Image signatures (SVG designs): only hashes the server recorded when it built someone's signature.
  app.get('/sig-img/:hash.png', async (req, reply) => {
    const { hash } = req.params as { hash: string };
    let png: Buffer | null = null;
    try {
      png = ctx.images.png(hash);
    } catch (e) {
      req.log.error({ err: e, hash }, 'image signature render failed');
    }
    if (!png) return reply.code(404).send();
    // The hash covers template version, values and fonts, so the image at this URL never changes.
    return reply.type('image/png').header('Cache-Control', 'public, max-age=31536000, immutable').header('Access-Control-Allow-Origin', '*').send(png);
  });

  // Logos: uploaded (DATA_DIR/assets) wins over bundled (assets/).
  app.get('/assets/:company/:file', async (req, reply) => {
    const { company, file } = req.params as { company: string; file: string };
    if (!/^[a-z0-9-]+$/.test(company) || !/^[a-z0-9][a-z0-9._-]*\.(png|jpe?g|gif)$/i.test(file)) {
      return reply.code(404).send();
    }
    for (const base of [path.join(ctx.env.dataDir, 'assets'), ctx.env.assetsDir]) {
      const full = path.join(base, company, file);
      if (fs.existsSync(full)) {
        return reply
          .type(file.endsWith('.png') ? 'image/png' : file.endsWith('.gif') ? 'image/gif' : 'image/jpeg')
          .header('Cache-Control', 'public, max-age=3600')
          .header('Access-Control-Allow-Origin', '*')
          .send(fs.createReadStream(full));
      }
    }
    return reply.code(404).send();
  });
}
