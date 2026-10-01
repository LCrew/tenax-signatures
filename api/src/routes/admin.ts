import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { actorOf, requireAdmin, type Identity } from '../auth/plugin.js';
import { hashPassword, passwordProblems } from '../auth/local.js';
import { GraphDiagnosticError, certThumbprintSha256, splitPem } from '../services/directory.js';
import {
  TemplateError,
  signatureDataFor,
  validateMeta,
  validateTemplateSource,
  type SignatureData,
} from '../services/renderer.js';
import { importTemplatesFromDisk } from '../services/settings.js';
import type { Company, ComposeType, ResolvedUser, TemplateKind } from '../types.js';
import { overridePatchSchema } from './signature.js';
import { renderManifest } from './addin.js';

type Handler = (req: FastifyRequest, reply: FastifyReply, admin: Identity) => Promise<unknown>;

const typeSchema = z.enum(['newMail', 'reply', 'forward']).default('newMail');
const kindSchema = z.enum(['new', 'reply', 'meta']);
const guid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Must be a GUID (object ID)');
const optionalGuid = z.union([guid, z.literal('')]);

function summary(u: ResolvedUser, companies: Company[]) {
  return {
    upn: u.upn,
    displayName: u.fields.displayName,
    jobTitle: u.fields.jobTitleLv,
    company: u.company,
    companyName: companies.find((c) => c.key === u.company)?.displayName ?? u.company,
    companySource: u.companySource,
    conflict: u.conflict,
    candidates: u.companyCandidates,
    missing: u.missing,
    overridden: Object.entries(u.sources).filter(([, s]) => s === 'override').map(([k]) => k),
    isAdmin: u.isAdmin,
    isPilot: u.isPilot,
  };
}

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection from directory data.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const guard = (h: Handler) => async (req: FastifyRequest, reply: FastifyReply) => {
    const admin = await requireAdmin(req, reply, ctx);
    if (!admin) return reply;
    try {
      return await h(req, reply, admin);
    } catch (e) {
      if (e instanceof TemplateError) return reply.code(422).send({ error: e.message, line: e.line });
      if (e instanceof z.ZodError) return reply.code(400).send({ error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      throw e;
    }
  };
  const audit = (admin: Identity, action: string, target: string, before: unknown, after: unknown) =>
    ctx.repo.audit(actorOf(admin), action, target, before, after);

  const findCompany = (key: string) => ctx.repo.listCompanies().find((c) => c.key === key);

  /** Previews load images from the host the admin is browsing, so they work before DNS/TLS is live. */
  const previewSettings = (req: FastifyRequest) => ({ ...ctx.settings.get(), publicUrl: `${req.protocol}://${req.host}` });

  function renderFor(req: FastifyRequest, user: ResolvedUser, type: ComposeType) {
    const company = findCompany(user.company);
    if (!company) throw new TemplateError(`Company "${user.company}" is not configured`);
    return ctx.renderer.render({ company, type, data: signatureDataFor(user), settings: previewSettings(req) });
  }

  // ───────────────────────────── Users ─────────────────────────────

  app.get('/api/admin/users', guard(async (req) => {
    const q = String((req.query as any).search ?? '').trim().toLowerCase();
    const companies = ctx.repo.listCompanies();
    const users = await ctx.resolver.resolveAll();
    return users
      .filter((u) => !q || u.upn.includes(q) || (u.fields.displayName ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.fields.displayName ?? a.upn).localeCompare(b.fields.displayName ?? b.upn, 'lv'))
      .map((u) => summary(u, companies));
  }));

  app.get('/api/admin/users/:upn', guard(async (req, reply) => {
    const { upn } = req.params as { upn: string };
    const user = await ctx.resolver.resolve(upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    return {
      ...summary(user, ctx.repo.listCompanies()),
      oid: user.oid,
      fields: user.fields,
      sources: user.sources,
      entra: user.entra,
      overrides: user.overrides,
      history: ctx.repo.listAudit(20, user.upn),
    };
  }));

  app.get('/api/admin/users/:upn/preview', guard(async (req, reply) => {
    const { upn } = req.params as { upn: string };
    const type = typeSchema.parse((req.query as any).type);
    const user = await ctx.resolver.resolve(upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    return reply.type('text/html; charset=utf-8').send(renderFor(req, user, type));
  }));

  /** Preview with unsaved corrections applied (Person page). Nothing is stored. */
  app.post('/api/admin/users/:upn/preview-draft', guard(async (req, reply) => {
    const { upn } = req.params as { upn: string };
    const body = z.object({ type: typeSchema, overrides: overridePatchSchema.default({}) }).parse(req.body);
    const user = await ctx.resolver.resolve(upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    const merged = { ...(user.overrides ?? { upn: user.upn }), ...body.overrides, upn: user.upn };
    const groupIds = await ctx.resolver.groupIds(user.oid);
    const draftUser = ctx.resolver.build(user.entra, groupIds, merged);
    return reply.type('text/html; charset=utf-8').send(renderFor(req, draftUser, body.type));
  }));

  app.put('/api/admin/users/:upn/overrides', guard(async (req, reply, admin) => {
    const { upn } = req.params as { upn: string };
    const patch = overridePatchSchema.parse(req.body);
    if (patch.company && !findCompany(patch.company)) return reply.code(400).send({ error: `Unknown company ${patch.company}` });
    const user = await ctx.resolver.resolve(upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    const before = ctx.repo.getOverrides(user.upn);
    const next = { ...(before ?? { upn: user.upn }), ...patch, upn: user.upn, updatedBy: actorOf(admin), updatedAt: new Date().toISOString() };
    ctx.repo.saveOverrides(next);
    audit(admin, 'overrides.update', user.upn, before, next);
    return { ok: true };
  }));

  // ───────────────────────────── Report ─────────────────────────────

  async function reportRows() {
    const companies = ctx.repo.listCompanies();
    return (await ctx.resolver.resolveAll()).map((u) => summary(u, companies));
  }

  app.get('/api/admin/report', guard(async () => {
    const rows = await reportRows();
    const byCompany: Record<string, number> = {};
    for (const r of rows) byCompany[r.company] = (byCompany[r.company] ?? 0) + 1;
    const missingByField: Record<string, number> = {};
    for (const r of rows) for (const f of r.missing) missingByField[f] = (missingByField[f] ?? 0) + 1;
    return {
      total: rows.length,
      complete: rows.filter((r) => r.missing.length === 0).length,
      conflicts: rows.filter((r) => r.conflict).length,
      defaulted: rows.filter((r) => r.companySource === 'default').length,
      overridden: rows.filter((r) => r.overridden.length > 0).length,
      byCompany,
      missingByField,
      rows,
    };
  }));

  app.get('/api/admin/report.csv', guard(async (_req, reply) => {
    const rows = await reportRows();
    const header = ['upn', 'displayName', 'company', 'companySource', 'multiGroupConflict', 'conflictingCompanies', 'missingFields', 'overriddenFields'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [r.upn, r.displayName, r.company, r.companySource, r.conflict ? 'yes' : 'no', r.conflict ? r.candidates.join(' ') : '', r.missing.join(' '), r.overridden.join(' ')]
          .map(csvCell)
          .join(','),
      );
    }
    return reply
      .type('text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="signature-report-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send('﻿' + lines.join('\r\n')); // BOM so Excel opens UTF-8 (diacritics) correctly
  }));

  // ───────────────────────────── Companies & groups ─────────────────────────────

  const companySchema = z.object({
    displayName: z.string().trim().min(1).max(80),
    legalName: z.string().trim().min(1).max(160),
    groupName: z.string().trim().min(1).max(256),
    groupId: optionalGuid,
    priority: z.number().int().min(1).max(999),
  });

  app.get('/api/admin/companies', guard(async () => ctx.repo.listCompanies()));

  app.put('/api/admin/companies/:key', guard(async (req, reply, admin) => {
    const { key } = req.params as { key: string };
    const before = findCompany(key);
    if (!before) return reply.code(404).send({ error: 'Unknown company' });
    const body = companySchema.parse(req.body);
    const clash = ctx.repo.listCompanies().find((c) => c.key !== key && body.groupId && c.groupId.toLowerCase() === body.groupId.toLowerCase());
    if (clash) return reply.code(409).send({ error: `That group is already mapped to ${clash.displayName}` });
    const next: Company = { ...before, ...body };
    ctx.repo.upsertCompany(next);
    ctx.resolver.clearCache();
    audit(admin, 'company.update', `company:${key}`, before, next);
    return next;
  }));

  app.post('/api/admin/companies', guard(async (req, reply, admin) => {
    const body = companySchema
      .extend({ key: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, 'Key: lowercase letters, digits and dashes'), copyFrom: z.string().optional() })
      .parse(req.body);
    if (findCompany(body.key)) return reply.code(409).send({ error: 'A company with that key already exists' });
    const { copyFrom, ...company } = body;
    ctx.repo.upsertCompany(company);
    const source = copyFrom ?? ctx.repo.listCompanies()[0]?.key;
    for (const kind of ['new', 'reply', 'meta'] as TemplateKind[]) {
      const t = source && ctx.repo.latestTemplate(source, kind);
      if (t) ctx.repo.addTemplateVersion({ company: body.key, kind, content: t.content, note: `Copied from ${source} v${t.version}`, createdBy: actorOf(admin) });
    }
    audit(admin, 'company.create', `company:${body.key}`, null, company);
    return company;
  }));

  app.delete('/api/admin/companies/:key', guard(async (req, reply, admin) => {
    const { key } = req.params as { key: string };
    const before = findCompany(key);
    if (!before) return reply.code(404).send({ error: 'Unknown company' });
    if (ctx.settings.get().defaultCompany === key) return reply.code(409).send({ error: 'Choose a different default company before removing this one' });
    if (ctx.repo.listSharedMailboxes().some((m) => m.company === key)) return reply.code(409).send({ error: 'Shared mailboxes still use this company' });
    ctx.repo.deleteCompany(key);
    ctx.resolver.clearCache();
    audit(admin, 'company.delete', `company:${key}`, before, null);
    return { ok: true };
  }));

  app.get('/api/admin/directory/groups', guard(async (req) => {
    const q = String((req.query as any).search ?? '').trim();
    if (q.length < 2) return [];
    return ctx.directory().searchGroups(q);
  }));

  // ───────────────────────────── Shared mailboxes ─────────────────────────────

  const mailboxSchema = z.object({
    email: z.string().trim().toLowerCase().email(),
    company: z.string(),
    displayName: z.string().trim().min(1).max(120),
    officePhone: z.string().trim().max(40).nullable().optional().transform((v) => v || null),
  });

  app.get('/api/admin/shared-mailboxes', guard(async () => ctx.repo.listSharedMailboxes()));
  app.put('/api/admin/shared-mailboxes/:email', guard(async (req, reply, admin) => {
    const body = mailboxSchema.parse({ ...(req.body as object), email: (req.params as any).email });
    if (!findCompany(body.company)) return reply.code(400).send({ error: 'Unknown company' });
    const before = ctx.repo.getSharedMailbox(body.email);
    ctx.repo.upsertSharedMailbox(body);
    audit(admin, before ? 'mailbox.update' : 'mailbox.create', `mailbox:${body.email}`, before ?? null, body);
    return body;
  }));
  app.delete('/api/admin/shared-mailboxes/:email', guard(async (req, _reply, admin) => {
    const email = (req.params as any).email.toLowerCase();
    const before = ctx.repo.getSharedMailbox(email);
    ctx.repo.deleteSharedMailbox(email);
    audit(admin, 'mailbox.delete', `mailbox:${email}`, before ?? null, null);
    return { ok: true };
  }));

  // ───────────────────────────── Templates ─────────────────────────────

  app.get('/api/admin/templates', guard(async () =>
    ctx.repo.listCompanies().map((c) => ({
      company: c,
      new: ctx.repo.latestTemplate(c.key, 'new'),
      reply: ctx.repo.latestTemplate(c.key, 'reply'),
      meta: ctx.repo.latestTemplate(c.key, 'meta'),
    })),
  ));

  app.get('/api/admin/templates/:company/history', guard(async (req) => {
    const { company } = req.params as { company: string };
    const kind = (req.query as any).kind ? kindSchema.parse((req.query as any).kind) : undefined;
    return ctx.repo.listTemplateVersions(company, kind).map(({ content: _c, ...rest }) => rest);
  }));

  app.get('/api/admin/templates/version/:id', guard(async (req, reply) => {
    const t = ctx.repo.getTemplateVersion(Number((req.params as any).id));
    return t ?? reply.code(404).send({ error: 'Version not found' });
  }));

  app.post('/api/admin/templates/:company/:kind', guard(async (req, reply, admin) => {
    const { company, kind: rawKind } = req.params as { company: string; kind: string };
    const kind = kindSchema.parse(rawKind);
    if (!findCompany(company)) return reply.code(404).send({ error: 'Unknown company' });
    const body = z.object({ content: z.string().min(1).max(100_000), note: z.string().max(200).optional() }).parse(req.body);
    if (kind === 'meta') validateMeta(body.content);
    else validateTemplateSource(body.content);
    const before = ctx.repo.latestTemplate(company, kind);
    if (before?.content === body.content) return before;
    const saved = ctx.repo.addTemplateVersion({ company, kind, content: body.content, note: body.note ?? null, createdBy: actorOf(admin) });
    audit(admin, 'template.save', `template:${company}/${kind}`, before ? { version: before.version } : null, { version: saved.version, note: saved.note });
    return saved;
  }));

  app.post('/api/admin/templates/restore/:id', guard(async (req, reply, admin) => {
    const old = ctx.repo.getTemplateVersion(Number((req.params as any).id));
    if (!old) return reply.code(404).send({ error: 'Version not found' });
    const saved = ctx.repo.addTemplateVersion({ company: old.company, kind: old.kind, content: old.content, note: `Restored from v${old.version}`, createdBy: actorOf(admin) });
    audit(admin, 'template.restore', `template:${old.company}/${old.kind}`, { version: old.version }, { version: saved.version });
    return saved;
  }));

  app.post('/api/admin/templates/reload', guard(async (_req, _reply, admin) => {
    let imported = 0;
    for (const c of ctx.repo.listCompanies()) imported += importTemplatesFromDisk(ctx.repo, ctx.env, c.key, actorOf(admin));
    audit(admin, 'template.reload', 'templates', null, { imported });
    return { imported };
  }));

  /** Live preview of an unsaved draft, for any user or a sample person. */
  const previewSchema = z.object({
    company: z.string(),
    type: typeSchema,
    upn: z.string().optional(),
    template: z.string().max(100_000).optional(),
    meta: z.string().max(20_000).optional(),
  });
  app.post('/api/admin/templates/preview', guard(async (req, reply) => {
    const body = previewSchema.parse(req.body);
    const company = findCompany(body.company);
    if (!company) return reply.code(404).send({ error: 'Unknown company' });
    let data: SignatureData = SAMPLE_PERSON;
    if (body.upn) {
      const user = await ctx.resolver.resolve(body.upn);
      if (!user) return reply.code(404).send({ error: 'User not found in directory' });
      data = signatureDataFor(user);
    }
    const html = ctx.renderer.render({ company, type: body.type, data, settings: previewSettings(req), draft: { template: body.template, meta: body.meta } });
    return reply.type('text/html; charset=utf-8').send(html);
  }));

  // ───────────────────────────── Logo / image assets ─────────────────────────────

  const uploadsDir = (company: string) => path.join(ctx.env.dataDir, 'assets', company);
  const safeName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}\.(png|jpe?g|gif)$/i, 'File name: letters, digits, dot, dash; .png/.jpg/.gif');

  app.get('/api/admin/assets/:company', guard(async (req) => {
    const { company } = req.params as { company: string };
    const names = new Set<string>();
    for (const dir of [path.join(ctx.env.assetsDir, company), uploadsDir(company)]) {
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (safeName.safeParse(f).success) names.add(f);
    }
    const base = ctx.settings.get().publicUrl;
    return [...names].sort().map((name) => ({ name, url: `${base}/assets/${company}/${name}`, localUrl: `/assets/${company}/${name}` }));
  }));

  app.post('/api/admin/assets/:company', { bodyLimit: 1_000_000 }, guard(async (req, reply, admin) => {
    const { company } = req.params as { company: string };
    if (!findCompany(company)) return reply.code(404).send({ error: 'Unknown company' });
    const body = z.object({ name: safeName, dataBase64: z.string().max(900_000) }).parse(req.body);
    const buf = Buffer.from(body.dataBase64, 'base64');
    const isPng = buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isJpg = buf[0] === 0xff && buf[1] === 0xd8;
    const isGif = buf.subarray(0, 3).toString('ascii') === 'GIF';
    if (!isPng && !isJpg && !isGif) return reply.code(400).send({ error: 'Upload a PNG, JPEG or GIF image' });
    fs.mkdirSync(uploadsDir(company), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir(company), body.name.toLowerCase()), buf);
    audit(admin, 'asset.upload', `asset:${company}/${body.name}`, null, { bytes: buf.length });
    return { name: body.name.toLowerCase(), url: `${ctx.settings.get().publicUrl}/assets/${company}/${body.name.toLowerCase()}` };
  }));

  // ───────────────────────────── Settings ─────────────────────────────

  const publicSettings = () => {
    const s = ctx.settings.get();
    const creds = ctx.settings.getCredentials();
    return {
      ...s,
      mockForcedByEnv: ctx.env.mockGraph,
      hasClientSecret: !!creds.clientSecret,
      hasCertificate: !!creds.privateKeyPem,
      certificateExpires: creds.certificatePem ? new crypto.X509Certificate(creds.certificatePem).validTo : null,
    };
  };

  app.get('/api/admin/settings', guard(async () => publicSettings()));

  const generalSchema = z
    .object({
      publicUrl: z.string().url().refine((u) => /^https?:\/\//.test(u), 'Must start with https://'),
      defaultCompany: z.string(),
      adminGroupId: optionalGuid,
      adminGroupName: z.string().trim().max(256),
      pilotGroupId: optionalGuid,
      pilotGroupName: z.string().trim().max(256),
      selfServiceEnabled: z.boolean(),
      selfServiceFields: z.array(z.enum(['jobTitleEn', 'hideMobile', 'mobilePhone', 'jobTitleLv'])),
      language: z.enum(['lv', 'en', 'bilingual']),
      allowedOrigins: z.array(z.string().url()).max(10),
      setupStep: z.number().int().min(0).max(20),
    })
    .partial();

  app.put('/api/admin/settings', guard(async (req, reply, admin) => {
    const patch = generalSchema.parse(req.body);
    if (patch.defaultCompany && !findCompany(patch.defaultCompany)) return reply.code(400).send({ error: 'Unknown default company' });
    const before = ctx.settings.get();
    ctx.settings.update(patch);
    if (patch.adminGroupId !== undefined || patch.pilotGroupId !== undefined) ctx.resolver.clearCache();
    const changed = Object.keys(patch).filter((k) => k !== 'setupStep');
    if (changed.length) audit(admin, 'settings.update', 'settings', pickKeys(before, changed), pickKeys(patch, changed));
    return publicSettings();
  }));

  const directorySchema = z.object({
    directoryMode: z.enum(['mock', 'graph']),
    tenantId: optionalGuid.optional(),
    clientId: optionalGuid.optional(),
    appIdUri: z.string().trim().max(300).optional(),
    credentialType: z.enum(['certificate', 'secret', 'none']).optional(),
    clientSecret: z.string().max(500).optional(),
    certificatePem: z.string().max(20_000).optional(),
    privateKeyPem: z.string().max(20_000).optional(),
  });

  function parseDirectory(body: unknown) {
    const b = directorySchema.parse(body);
    const current = ctx.settings.getCredentials();
    let creds = { ...current };
    let thumbprint = ctx.settings.get().certificateThumbprint;
    if (b.credentialType === 'secret' && b.clientSecret) creds = { clientSecret: b.clientSecret };
    if (b.credentialType === 'certificate' && (b.certificatePem || b.privateKeyPem)) {
      const merged = `${b.certificatePem ?? ''}\n${b.privateKeyPem ?? ''}`;
      const parts = splitPem(merged);
      if (!parts.certificatePem || !parts.privateKeyPem) {
        throw new TemplateError('Provide both the certificate (BEGIN CERTIFICATE) and its private key (BEGIN PRIVATE KEY).');
      }
      let key: crypto.KeyObject;
      try {
        key = crypto.createPrivateKey(parts.privateKeyPem);
      } catch {
        throw new TemplateError('The private key could not be read. Upload an unencrypted PEM key.');
      }
      const cert = new crypto.X509Certificate(parts.certificatePem);
      if (!cert.checkPrivateKey(key)) throw new TemplateError('The private key does not belong to this certificate.');
      creds = {
        certificatePem: parts.certificatePem,
        privateKeyPem: key.export({ type: 'pkcs8', format: 'pem' }).toString(), // MSAL expects PKCS#8
      };
      thumbprint = certThumbprintSha256(parts.certificatePem);
    }
    const settingsPatch = {
      directoryMode: b.directoryMode,
      ...(b.tenantId !== undefined && { tenantId: b.tenantId }),
      ...(b.clientId !== undefined && { clientId: b.clientId }),
      ...(b.appIdUri !== undefined && { appIdUri: b.appIdUri.replace(/\/+$/, '') }),
      ...(b.credentialType !== undefined && { credentialType: b.credentialType }),
      certificateThumbprint: thumbprint,
    };
    return { settingsPatch, creds };
  }

  app.post('/api/admin/settings/directory/test', guard(async (req, reply) => {
    const { settingsPatch, creds } = parseDirectory(req.body);
    try {
      const dir = ctx.buildDirectory(settingsPatch, creds);
      return await dir.testConnection();
    } catch (e: any) {
      return reply.code(200).send({ ok: false, detail: explainGraphError(e) });
    }
  }));

  app.put('/api/admin/settings/directory', guard(async (req, _reply, admin) => {
    const { settingsPatch, creds } = parseDirectory(req.body);
    const before = ctx.settings.get();
    ctx.settings.update(settingsPatch);
    ctx.settings.setCredentials(creds);
    ctx.resetDirectory();
    audit(admin, 'settings.directory', 'settings', pickKeys(before, Object.keys(settingsPatch)), { ...settingsPatch, credentials: '(updated)' });
    return publicSettings();
  }));

  app.post('/api/admin/setup/complete', guard(async (_req, _reply, admin) => {
    ctx.settings.update({ setupComplete: true });
    audit(admin, 'setup.complete', 'settings', null, null);
    return publicSettings();
  }));

  /** Re-opens the setup wizard for admins (e.g. to connect Entra later). Nothing is reset. */
  app.post('/api/admin/setup/restart', guard(async (_req, _reply, admin) => {
    ctx.settings.update({ setupComplete: false, setupStep: 2 });
    audit(admin, 'setup.restart', 'settings', null, null);
    return publicSettings();
  }));

  app.post('/api/admin/cache/clear', guard(async (_req, _reply, admin) => {
    ctx.resolver.clearCache();
    audit(admin, 'cache.clear', 'cache', null, null);
    return { ok: true };
  }));

  // ───────────────────────────── Local admin accounts ─────────────────────────────

  app.get('/api/admin/accounts', guard(async () =>
    ctx.repo.listAdmins().map(({ passwordHash: _p, ...a }) => a),
  ));

  app.post('/api/admin/accounts', guard(async (req, reply, admin) => {
    const body = z.object({ username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._@-]+$/), password: z.string() }).parse(req.body);
    const problem = passwordProblems(body.password);
    if (problem) return reply.code(400).send({ error: problem });
    if (ctx.repo.getAdminByUsername(body.username)) return reply.code(409).send({ error: 'That username is taken' });
    const created = ctx.repo.createAdmin(body.username, await hashPassword(body.password));
    audit(admin, 'account.create', `account:${created.username}`, null, { username: created.username });
    return { id: created.id, username: created.username };
  }));

  app.put('/api/admin/accounts/:id/password', guard(async (req, reply, admin) => {
    const id = Number((req.params as any).id);
    const target = ctx.repo.getAdminById(id);
    if (!target) return reply.code(404).send({ error: 'Account not found' });
    const { password } = z.object({ password: z.string() }).parse(req.body);
    const problem = passwordProblems(password);
    if (problem) return reply.code(400).send({ error: problem });
    ctx.repo.updateAdminPassword(id, await hashPassword(password));
    // Sign out everywhere except the current session if you're changing your own password.
    if (!(admin.kind === 'local' && admin.adminId === id)) ctx.repo.deleteSessionsForAdmin(id);
    audit(admin, 'account.password', `account:${target.username}`, null, null);
    return { ok: true };
  }));

  app.delete('/api/admin/accounts/:id', guard(async (req, reply, admin) => {
    const id = Number((req.params as any).id);
    const target = ctx.repo.getAdminById(id);
    if (!target) return reply.code(404).send({ error: 'Account not found' });
    if (admin.kind === 'local' && admin.adminId === id) return reply.code(409).send({ error: "You can't remove the account you're signed in with" });
    if (ctx.repo.countAdmins() <= 1) return reply.code(409).send({ error: 'Keep at least one local account as a break-glass login' });
    ctx.repo.deleteAdmin(id);
    audit(admin, 'account.delete', `account:${target.username}`, { username: target.username }, null);
    return { ok: true };
  }));

  // ───────────────────────────── Diagnostics ─────────────────────────────

  app.get('/api/admin/audit', guard(async (req) => ctx.repo.listAudit(Math.min(Number((req.query as any).limit ?? 200), 1000))));
  app.get('/api/admin/telemetry', guard(async () => ctx.repo.listTelemetry(200)));

  app.get('/api/admin/addin/manifest.xml', guard(async (_req, reply) => {
    const xml = renderManifest(ctx);
    return reply
      .type('application/xml; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="tenax-signature-manifest.xml"')
      .send(xml);
  }));
}

const SAMPLE_PERSON: SignatureData = {
  displayName: 'Līga Paraudziņa',
  jobTitleLv: 'Pārdošanas projektu vadītāja',
  jobTitleEn: 'Sales Project Manager',
  mobilePhone: '+371 29 123 456',
  officePhone: '+371 67 123 456',
  email: 'liga.paraudzina@tenaxgrupa.lv',
  department: 'Pārdošana',
};

function pickKeys(o: object, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, (o as any)[k]]));
}

function explainGraphError(e: any): string {
  if (e instanceof GraphDiagnosticError) return e.message;
  const m = String(e?.errorMessage ?? e?.message ?? e);
  if (/AADSTS700016/.test(m)) return 'Entra did not find that application (client) ID in this tenant. Check both IDs.';
  if (/AADSTS90002|AADSTS900023/.test(m)) return 'That tenant ID was not recognised.';
  if (/AADSTS7000215/.test(m)) return 'The client secret is wrong or expired.';
  if (/AADSTS700027|AADSTS700024/.test(m)) return "The certificate isn't registered on the app, or the private key doesn't match the uploaded .cer.";
  if (/Graph 403|Authorization_RequestDenied/.test(m)) return 'Signed in, but Graph refused the call. Grant admin consent for User.Read.All and GroupMember.Read.All.';
  return m.slice(0, 400);
}
