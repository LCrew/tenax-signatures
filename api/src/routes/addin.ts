import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { API_SCOPE } from '../auth/plugin.js';

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Manifest with this deployment's host, app ID and add-in ID filled in. */
export function renderManifest(ctx: AppContext): string {
  const s = ctx.settings.get();
  const file = path.join(ctx.env.addinDistDir, 'manifest.template.xml');
  const fallback = path.resolve(ctx.env.addinDistDir, '..', 'manifest.template.xml');
  const tpl = fs.readFileSync(fs.existsSync(file) ? file : fallback, 'utf8');
  const values: Record<string, string> = {
    PUBLIC_URL: s.publicUrl.replace(/\/+$/, ''),
    ADDIN_ID: s.addinId,
    CLIENT_ID: s.clientId || '00000000-0000-0000-0000-000000000000',
    API_SCOPE_URI: s.appIdUri || `api://${new URL(s.publicUrl).host}/${s.clientId}`,
    VERSION: '1.0.0.0',
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in values ? xmlEscape(values[k]) : m));
}

export function addinRoutes(app: FastifyInstance, ctx: AppContext) {
  // Classic Outlook's JS-only runtime refuses scripts not listed here.
  app.get('/.well-known/microsoft-officeaddins-allowed.json', async () => ({
    allowed: [`${ctx.settings.get().publicUrl}/addin/launchevent.js`],
  }));

  /** The bundle with runtime config prepended, so the image never needs rebuilding per tenant. */
  app.get('/addin/launchevent.js', async (_req, reply) => {
    const file = path.join(ctx.env.addinDistDir, 'launchevent.js');
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

  app.get('/addin/manifest.xml', async (_req, reply) =>
    reply.type('application/xml; charset=utf-8').send(renderManifest(ctx)),
  );

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
