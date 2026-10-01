import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { signatureDataFor } from '../services/renderer.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** /dev/preview — every fixture user's new + reply signature side by side. Mock mode, non-production only. */
export function devRoutes(app: FastifyInstance, ctx: AppContext) {
  if (!ctx.env.mockAuthHeader) return;
  app.get('/dev/preview', async (_req, reply) => {
    const settings = ctx.settings.get();
    const companies = ctx.repo.listCompanies();
    const users = await ctx.resolver.resolveAll();
    const rows = users.map((u) => {
      const company = companies.find((c) => c.key === u.company)!;
      const cell = (type: 'newMail' | 'reply') =>
        ctx.renderer.render({ company, type, data: signatureDataFor(u), settings: { ...settings, publicUrl: '' } });
      const flags = [u.companySource !== 'group' && `company via ${u.companySource}`, u.conflict && 'multi-group conflict', u.missing.length && `missing: ${u.missing.join(', ')}`]
        .filter(Boolean)
        .join(' · ');
      return `<tr><th><div>${esc(u.upn)}</div><small>${esc(company.displayName)}${flags ? ' — ' + esc(flags) : ''}</small></th><td>${cell('newMail')}</td><td>${cell('reply')}</td></tr>`;
    });
    return reply.type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><title>Signature preview</title>
<style>body{font-family:system-ui;margin:24px;background:#f3f4f6}table{border-collapse:collapse;background:#fff}th,td{border:1px solid #ddd;padding:16px;vertical-align:top;text-align:left}th{width:220px;font-weight:600}small{color:#666;font-weight:400}</style>
<h1>Fixture signatures (mock mode)</h1><table><tr><th>User</th><th>New message</th><th>Reply / forward</th></tr>${rows.join('')}</table>`);
  });
}
