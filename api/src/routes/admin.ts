import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { actorOf, requireStaff, type Access, type Identity } from '../auth/plugin.js';
import { SESSION_COOKIE, hashPassword, hashSessionId, passwordProblems } from '../auth/local.js';
import { GraphDiagnosticError, certThumbprintSha256, splitPem } from '../services/directory.js';
import {
  TemplateError,
  signatureDataFor,
  trialRender,
  validateMeta,
  validateTemplateSource,
  type SignatureData,
} from '../services/renderer.js';
import { importTemplatesFromDisk } from '../services/settings.js';
import { blockDocSchema, compileBlocks, extractBlocks, presetDoc, stripBlocksHeader } from '../services/blocks.js';
import { applyOverrides, ensureDefaultDesign, metaOverridesSchema, newDesignId } from '../services/designs.js';
import { resolveCompany } from '../services/resolver.js';
import type { Company, ComposeType, Design, Overrides, ResolvedUser, TemplateKind } from '../types.js';
import { overridePatchSchema } from './signature.js';
import { renderManifest } from './addin.js';

type Handler = (req: FastifyRequest, reply: FastifyReply, admin: Identity) => Promise<unknown>;
type StaffHandler = (req: FastifyRequest, reply: FastifyReply, admin: Identity, access: Access) => Promise<unknown>;

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
    excluded: u.excluded,
    design: u.design,
    designLocked: u.designLocked,
  };
}

function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // Neutralise spreadsheet formula injection from directory data.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const handleErrors = async (reply: FastifyReply, run: () => Promise<unknown>) => {
    try {
      return await run();
    } catch (e) {
      if (e instanceof TemplateError) return reply.code(422).send({ error: e.message, line: e.line });
      if (e instanceof z.ZodError) return reply.code(400).send({ error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
      throw e;
    }
  };
  /** IT administrators only. The default for every admin route. */
  const guard = (h: Handler) => async (req: FastifyRequest, reply: FastifyReply) => {
    const access = await requireStaff(req, reply, ctx);
    if (!access) return reply;
    if (!access.global) return reply.code(403).send({ error: 'Only IT administrators can do this' });
    return handleErrors(reply, () => h(req, reply, access.identity));
  };
  /** IT administrators and company editors. The handler MUST check access.can(company) for anything it touches. */
  const staff = (h: StaffHandler) => async (req: FastifyRequest, reply: FastifyReply) => {
    const access = await requireStaff(req, reply, ctx);
    if (!access) return reply;
    return handleErrors(reply, () => h(req, reply, access.identity, access));
  };
  const forbidden = (reply: FastifyReply) => reply.code(403).send({ error: 'That company is outside your signature editor rights' });
  const audit = (admin: Identity, action: string, target: string, before: unknown, after: unknown) =>
    ctx.repo.audit(actorOf(admin), action, target, before, after);

  const findCompany = (key: string) => ctx.repo.listCompanies().find((c) => c.key === key);

  /** Previews load images from the host the admin is browsing, so they work before DNS/TLS is live. */
  const previewSettings = (req: FastifyRequest) => ({ ...ctx.settings.get(), publicUrl: `${req.protocol}://${req.host}` });

  function renderFor(req: FastifyRequest, user: ResolvedUser, type: ComposeType) {
    const company = findCompany(user.company);
    if (!company) throw new TemplateError(`Company "${user.company}" is not configured`);
    return ctx.renderer.render({ company, type, data: signatureDataFor(user), settings: previewSettings(req), design: ctx.repo.getDesign(user.design.id) });
  }

  /** Admin/editor patch = self-service fields + which design the person gets (optionally locked). */
  const adminPatchSchema = overridePatchSchema.extend({
    design: z.union([z.string().max(80), z.null()]).optional(),
    designLocked: z.boolean().optional(),
  });
  function checkDesignFor(user: ResolvedUser, design: string | null | undefined, company?: string | null): string | null {
    if (!design) return null;
    const target = company === undefined ? user.company : company ?? resolveCompany(user.groupIds ?? [], ctx.repo.listCompanies(), null, ctx.settings.get().defaultCompany).company;
    const d = ctx.repo.getDesign(design);
    return d && d.company === target ? null : 'That design doesn’t belong to this person’s company';
  }

  // ───────────────────────────── Users ─────────────────────────────

  /** A person an editor may see: one whose signature comes from a company they edit. Out of scope = "not found". */
  async function scopedUser(access: Access, upn: string) {
    const user = await ctx.resolver.resolve(upn);
    // Excluded accounts (service accounts…) are an IT matter: invisible to company editors.
    return user && access.can(user.company) && (access.global || !user.excluded) ? user : null;
  }

  app.get('/api/admin/users', staff(async (req, _reply, _admin, access) => {
    const q = String((req.query as any).search ?? '').trim().toLowerCase();
    const companies = ctx.repo.listCompanies();
    const users = await ctx.resolver.resolveAll();
    // ?view=excluded lists the accounts left out of signatures (IT only); everyone else never sees them.
    const showExcluded = access.global && (req.query as any).view === 'excluded';
    return users
      .filter((u) => access.can(u.company))
      .filter((u) => (showExcluded ? !!u.excluded : !u.excluded))
      .filter((u) => !q || u.upn.includes(q) || (u.fields.displayName ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.fields.displayName ?? a.upn).localeCompare(b.fields.displayName ?? b.upn, 'lv'))
      .map((u) => summary(u, companies));
  }));

  app.get('/api/admin/users/:upn', staff(async (req, reply, _admin, access) => {
    const { upn } = req.params as { upn: string };
    const user = await scopedUser(access, upn);
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

  app.get('/api/admin/users/:upn/preview', staff(async (req, reply, _admin, access) => {
    const { upn } = req.params as { upn: string };
    const type = typeSchema.parse((req.query as any).type);
    const user = await scopedUser(access, upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    return reply.type('text/html; charset=utf-8').send(renderFor(req, user, type));
  }));

  /** Preview with unsaved corrections applied (Person page). Nothing is stored. */
  app.post('/api/admin/users/:upn/preview-draft', staff(async (req, reply, _admin, access) => {
    const { upn } = req.params as { upn: string };
    const body = z.object({ type: typeSchema, overrides: adminPatchSchema.default({}) }).parse(req.body);
    const user = await scopedUser(access, upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    if (!access.global && body.overrides.company !== undefined) return reply.code(403).send({ error: 'Only IT administrators can change which company a person belongs to' });
    const designProblem = checkDesignFor(user, body.overrides.design, body.overrides.company);
    if (designProblem) return reply.code(400).send({ error: designProblem });
    if (body.overrides.design !== undefined && (body.overrides.design ?? null) !== (user.overrides?.design ?? null)) (body.overrides as Overrides).chosenDesign = null;
    const merged = { ...(user.overrides ?? { upn: user.upn }), ...body.overrides, upn: user.upn };
    const groupIds = await ctx.resolver.groupIds(user.oid);
    const draftUser = ctx.resolver.build(user.entra, groupIds, merged);
    return reply.type('text/html; charset=utf-8').send(renderFor(req, draftUser, body.type));
  }));

  app.put('/api/admin/users/:upn/overrides', staff(async (req, reply, admin, access) => {
    const { upn } = req.params as { upn: string };
    const patch: Overrides & z.infer<typeof adminPatchSchema> = adminPatchSchema.parse(req.body) as any;
    // Moving someone to another company would take them out of (or into) an editor's scope: IT only.
    if (!access.global && patch.company !== undefined) return reply.code(403).send({ error: 'Only IT administrators can change which company a person belongs to' });
    if (patch.company && !findCompany(patch.company)) return reply.code(400).send({ error: `Unknown company ${patch.company}` });
    const user = await scopedUser(access, upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    const designProblem = checkDesignFor(user, patch.design, patch.company);
    if (designProblem) return reply.code(400).send({ error: designProblem });
    const before = ctx.repo.getOverrides(user.upn);
    // Changing the company changes which designs exist for them: drop design choices from the old company
    // (unless a design of the new company is set in the same request).
    if (patch.company !== undefined && (patch.company ?? null) !== (before?.company ?? null) && patch.design === undefined) {
      patch.design = null;
      patch.designLocked = false;
      patch.chosenDesign = null;
    }
    // An admin CHANGING the assigned design replaces the person's own earlier choice (they may choose again unless
    // locked). Saving other corrections leaves their choice alone.
    if (patch.design !== undefined && (patch.design ?? null) !== (before?.design ?? null)) patch.chosenDesign = null;
    if (patch.design === null) patch.designLocked = false;
    const next = { ...(before ?? { upn: user.upn }), ...patch, upn: user.upn, updatedBy: actorOf(admin), updatedAt: new Date().toISOString() };
    ctx.repo.saveOverrides(next);
    audit(admin, 'overrides.update', user.upn, before, next);
    return { ok: true };
  }));

  // ───────────────────────────── Report ─────────────────────────────

  async function reportRows(access: Access) {
    const companies = ctx.repo.listCompanies();
    return (await ctx.resolver.resolveAll()).filter((u) => access.can(u.company) && !u.excluded).map((u) => summary(u, companies));
  }

  /** Leave an account out of signatures (service accounts, test/room mailboxes) or include it again. IT only. */
  app.put('/api/admin/users/:upn/exclusion', guard(async (req, reply, admin) => {
    const { upn } = req.params as { upn: string };
    const body = z.object({ excluded: z.boolean(), reason: z.string().trim().max(200).optional() }).parse(req.body);
    const user = await ctx.resolver.resolve(upn);
    if (!user) return reply.code(404).send({ error: 'User not found in directory' });
    if (user.excluded?.by === 'group' && !body.excluded) {
      return reply.code(409).send({ error: `Excluded through ${ctx.settings.get().excludeGroupName}. Remove them from that group in Entra.` });
    }
    const before = ctx.repo.getExclusion(user.upn) ?? null;
    if (body.excluded) ctx.repo.setExclusion(user.upn, body.reason || null, actorOf(admin));
    else ctx.repo.removeExclusion(user.upn);
    audit(admin, body.excluded ? 'user.exclude' : 'user.include', user.upn, before, body.excluded ? { reason: body.reason ?? null } : null);
    return { ok: true };
  }));

  app.get('/api/admin/report', staff(async (_req, _reply, _admin, access) => {
    const rows = await reportRows(access);
    const excludedCount = access.global ? (await ctx.resolver.resolveAll()).filter((u) => u.excluded).length : 0;
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
      excluded: excludedCount,
      byCompany,
      missingByField,
      rows,
    };
  }));

  app.get('/api/admin/report.csv', staff(async (_req, reply, _admin, access) => {
    const rows = await reportRows(access);
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
    editorGroupName: z.string().trim().max(256).default(''),
    editorGroupId: optionalGuid.default(''),
  });

  // Editors see only their companies (names for the console); IT sees all, including group mappings.
  app.get('/api/admin/companies', staff(async (_req, _reply, _admin, access) =>
    access.global ? ctx.repo.listCompanies() : ctx.repo.listCompanies().filter((c) => access.can(c.key)).map(({ key, displayName, legalName, priority }) => ({ key, displayName, legalName, priority })),
  ));

  app.put('/api/admin/companies/:key', guard(async (req, reply, admin) => {
    const { key } = req.params as { key: string };
    const before = findCompany(key);
    if (!before) return reply.code(404).send({ error: 'Unknown company' });
    const body = companySchema.parse(req.body);
    const clash = ctx.repo.listCompanies().find((c) => c.key !== key && body.groupId && c.groupId.toLowerCase() === body.groupId.toLowerCase());
    if (clash) return reply.code(409).send({ error: `That group is already mapped to ${clash.displayName}` });
    const s = ctx.settings.get();
    if (body.editorGroupId && [s.adminGroupId, body.groupId].filter(Boolean).some((g) => g.toLowerCase() === body.editorGroupId.toLowerCase())) {
      return reply.code(409).send({ error: 'Use a separate group for signature editors, not the company or IT admins group' });
    }
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
    ensureDefaultDesign(ctx.repo, body.key);
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
    design: z.string().max(80).nullable().optional().transform((v) => v || null),
  });

  app.get('/api/admin/shared-mailboxes', guard(async () => ctx.repo.listSharedMailboxes()));
  app.put('/api/admin/shared-mailboxes/:email', guard(async (req, reply, admin) => {
    const body = mailboxSchema.parse({ ...(req.body as object), email: (req.params as any).email });
    if (!findCompany(body.company)) return reply.code(400).send({ error: 'Unknown company' });
    if (body.design && ctx.repo.getDesign(body.design)?.company !== body.company) return reply.code(400).send({ error: 'That design belongs to another company' });
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

  // ───────────────────────────── Designs ─────────────────────────────
  // Several designs per company (Standard, English, Service…). IT and that company's editors manage them.

  /** The design to work on: an explicit id (must belong to the company) or the company default. */
  function designOf(company: string, id?: string): Design | null {
    if (id) {
      const d = ctx.repo.getDesign(id);
      return d && d.company === company ? d : null;
    }
    return ctx.repo.listDesigns(company).find((d) => d.isDefault) ?? null;
  }

  app.get('/api/admin/designs', staff(async (req, reply, _admin, access) => {
    const company = String((req.query as any).company ?? '');
    if (company && !access.can(company)) return forbidden(reply);
    return ctx.repo.listDesigns(company || undefined).filter((d) => access.can(d.company));
  }));

  const designNameSchema = z.string().trim().min(1).max(60);
  app.post('/api/admin/designs', staff(async (req, reply, admin, access) => {
    const body = z
      .object({
        company: z.string(),
        name: designNameSchema,
        purpose: z.enum(['person', 'service']).default('person'),
        selectable: z.boolean().default(true),
        copyFrom: z.string().optional(),
      })
      .parse(req.body);
    if (!findCompany(body.company)) return reply.code(404).send({ error: 'Unknown company' });
    if (!access.can(body.company)) return forbidden(reply);
    const source = designOf(body.company, body.copyFrom);
    if (!source) return reply.code(400).send({ error: 'Copy from a design of the same company' });
    const existing = ctx.repo.listDesigns(body.company);
    const design: Design = {
      id: newDesignId(ctx.repo, body.company, body.name),
      company: body.company,
      name: body.name,
      purpose: body.purpose,
      selectable: body.purpose === 'person' && body.selectable,
      isDefault: false,
      sort: Math.max(0, ...existing.map((d) => d.sort)) + 1,
      metaOverrides: { ...source.metaOverrides },
      createdAt: new Date().toISOString(),
    };
    ctx.repo.upsertDesign(design);
    for (const kind of ['new', 'reply'] as const) {
      const t = ctx.repo.latestTemplate(body.company, kind, source.id);
      if (t) ctx.repo.addTemplateVersion({ company: body.company, design: design.id, kind, content: t.content, note: `Copied from ${source.name} v${t.version}`, createdBy: actorOf(admin) });
    }
    audit(admin, 'design.create', `design:${design.id}`, null, { name: design.name, purpose: design.purpose, copyFrom: source.id });
    return design;
  }));

  app.put('/api/admin/designs/:id', staff(async (req, reply, admin, access) => {
    const before = ctx.repo.getDesign((req.params as any).id);
    if (!before || !access.can(before.company)) return reply.code(404).send({ error: 'Design not found' });
    const body = z
      .object({ name: designNameSchema.optional(), selectable: z.boolean().optional(), isDefault: z.literal(true).optional(), metaOverrides: metaOverridesSchema.optional() })
      .strict()
      .parse(req.body);
    const next: Design = { ...before, ...body, isDefault: before.isDefault || !!body.isDefault };
    if (next.isDefault && next.purpose === 'service') return reply.code(400).send({ error: 'A service design can’t be the company default' });
    if (next.purpose === 'service') next.selectable = false;
    if (body.metaOverrides) {
      // The design's wording must still form valid brand settings and render with its layouts.
      const companyMeta = ctx.repo.latestTemplate(before.company, 'meta')?.content ?? '{}';
      const merged = applyOverrides(companyMeta, body.metaOverrides);
      validateMeta(merged);
      for (const k of ['new', 'reply'] as const) {
        const t = ctx.repo.latestTemplate(before.company, k, before.id);
        if (t) trialRender(t.content, merged, k);
      }
    }
    ctx.repo.upsertDesign(next);
    audit(admin, 'design.update', `design:${before.id}`, { name: before.name, selectable: before.selectable, isDefault: before.isDefault, metaOverrides: before.metaOverrides }, body);
    return ctx.repo.getDesign(before.id);
  }));

  app.delete('/api/admin/designs/:id', staff(async (req, reply, admin, access) => {
    const d = ctx.repo.getDesign((req.params as any).id);
    if (!d || !access.can(d.company)) return reply.code(404).send({ error: 'Design not found' });
    if (d.isDefault) return reply.code(409).send({ error: 'Make another design the default before removing this one' });
    // People using it fall back to their next valid design (resolveDesign ignores unknown ids); versions are kept.
    ctx.repo.deleteDesign(d.id);
    for (const m of ctx.repo.listSharedMailboxes().filter((x) => x.design === d.id)) ctx.repo.upsertSharedMailbox({ ...m, design: null });
    audit(admin, 'design.delete', `design:${d.id}`, { name: d.name }, null);
    return { ok: true };
  }));

  // ───────────────────────────── Templates ─────────────────────────────

  /** Latest version plus its visual design (null = hand-written HTML). */
  const withBlocks = (t: ReturnType<typeof ctx.repo.latestTemplate>) => (t ? { ...t, blocks: t.kind === 'meta' ? null : extractBlocks(t.content) } : t);

  app.get('/api/admin/templates', staff(async (_req, _reply, _admin, access) =>
    ctx.repo.listCompanies().filter((c) => access.can(c.key)).map((c) => ({
      company: access.global ? c : { key: c.key, displayName: c.displayName, legalName: c.legalName, priority: c.priority },
      // Default design's layouts (kept for older clients), the company brand, and every design with its layouts.
      new: withBlocks(ctx.repo.latestTemplate(c.key, 'new')),
      reply: withBlocks(ctx.repo.latestTemplate(c.key, 'reply')),
      meta: ctx.repo.latestTemplate(c.key, 'meta'),
      designs: ctx.repo.listDesigns(c.key).map((d) => ({
        ...d,
        new: withBlocks(ctx.repo.latestTemplate(c.key, 'new', d.id)),
        reply: withBlocks(ctx.repo.latestTemplate(c.key, 'reply', d.id)),
      })),
    })),
  ));

  /** Visual design → its HTML (without the design data), for switching a design to hand-written HTML. */
  app.post('/api/admin/templates/compile', staff(async (req, reply) => {
    const body = z.object({ kind: z.enum(['new', 'reply']), blocks: z.unknown() }).parse(req.body);
    return reply.type('text/plain; charset=utf-8').send(stripBlocksHeader(compileBlocks(blockDocSchema.parse(body.blocks), body.kind)));
  }));

  /** Starting points for the visual editor. */
  app.get('/api/admin/templates/presets', staff(async () => ({
    side: presetDoc('side'),
    stacked: presetDoc('stacked'),
    textOnly: presetDoc('textOnly'),
    reply: presetDoc('reply'),
  })));

  app.get('/api/admin/templates/:company/history', staff(async (req, reply, _admin, access) => {
    const { company } = req.params as { company: string };
    if (!access.can(company)) return forbidden(reply);
    const q = req.query as { kind?: string; design?: string };
    const kind = q.kind ? kindSchema.parse(q.kind) : undefined;
    const design = designOf(company, q.design);
    if (!design) return reply.code(404).send({ error: 'Design not found' });
    return ctx.repo.listTemplateVersions(company, kind, design.id).map(({ content: _c, ...rest }) => rest);
  }));

  app.get('/api/admin/templates/version/:id', staff(async (req, reply, _admin, access) => {
    const t = ctx.repo.getTemplateVersion(Number((req.params as any).id));
    return t && access.can(t.company) ? t : reply.code(404).send({ error: 'Version not found' });
  }));

  app.post('/api/admin/templates/:company/:kind', staff(async (req, reply, admin, access) => {
    const { company, kind: rawKind } = req.params as { company: string; kind: string };
    const kind = kindSchema.parse(rawKind);
    if (!findCompany(company)) return reply.code(404).send({ error: 'Unknown company' });
    if (!access.can(company)) return forbidden(reply);
    const raw = z
      .object({ content: z.string().min(1).max(100_000).optional(), blocks: z.unknown().optional(), note: z.string().max(200).optional(), design: z.string().max(80).optional() })
      .refine((b) => b.content || b.blocks, 'Send content or blocks')
      .parse(req.body);
    const design = kind === 'meta' ? null : designOf(company, raw.design);
    if (kind !== 'meta' && !design) return reply.code(404).send({ error: 'Design not found' });
    // Visual designs are compiled here, so the stored template is always server-generated, email-safe HTML.
    if (raw.blocks && kind === 'meta') return reply.code(400).send({ error: 'Brand settings have no visual layout' });
    // Hand-written HTML can put anything into every email the company sends: IT only. Editors use the visual designer.
    if (kind !== 'meta' && raw.content && !access.global) {
      return reply.code(403).send({ error: 'Signature editors can only save visual designs. Ask IT for hand-written HTML changes.' });
    }
    const body = { note: raw.note, content: raw.blocks ? compileBlocks(blockDocSchema.parse(raw.blocks), kind as 'new' | 'reply') : raw.content! };
    const companyMeta = ctx.repo.latestTemplate(company, 'meta')?.content ?? '{}';
    if (kind === 'meta') {
      validateMeta(body.content);
      // New brand settings must still render with every design's layouts and wording.
      for (const d of ctx.repo.listDesigns(company)) {
        for (const k of ['new', 'reply'] as const) {
          const t = ctx.repo.latestTemplate(company, k, d.id);
          if (t) trialRender(t.content, applyOverrides(body.content, d.metaOverrides), k);
        }
      }
    } else {
      validateTemplateSource(body.content);
      trialRender(body.content, applyOverrides(companyMeta, design!.metaOverrides), kind as 'new' | 'reply');
    }
    const before = ctx.repo.latestTemplate(company, kind, design?.id);
    if (before?.content === body.content) return before;
    const saved = ctx.repo.addTemplateVersion({ company, design: design?.id, kind, content: body.content, note: body.note ?? null, createdBy: actorOf(admin) });
    const target = design ? `template:${company}/${design.id}/${kind}` : `template:${company}/${kind}`;
    audit(admin, 'template.save', target, before ? { version: before.version } : null, { version: saved.version, note: saved.note });
    return saved;
  }));

  app.post('/api/admin/templates/restore/:id', staff(async (req, reply, admin, access) => {
    const old = ctx.repo.getTemplateVersion(Number((req.params as any).id));
    if (!old || !access.can(old.company)) return reply.code(404).send({ error: 'Version not found' });
    if (old.kind !== 'meta' && !ctx.repo.getDesign(old.design)) return reply.code(409).send({ error: 'That design was removed' });
    // Old versions are re-checked against today's rules before they go live again.
    if (old.kind === 'meta') validateMeta(old.content);
    else {
      if (!access.global && !extractBlocks(old.content)) return reply.code(403).send({ error: 'That version is hand-written HTML; only IT can restore it' });
      validateTemplateSource(old.content);
      const meta = applyOverrides(ctx.repo.latestTemplate(old.company, 'meta')?.content ?? '{}', ctx.repo.getDesign(old.design)!.metaOverrides);
      trialRender(old.content, meta, old.kind);
    }
    const saved = ctx.repo.addTemplateVersion({ company: old.company, design: old.design || undefined, kind: old.kind, content: old.content, note: `Restored from v${old.version}`, createdBy: actorOf(admin) });
    audit(admin, 'template.restore', `template:${old.company}/${old.design ? old.design + '/' : ''}${old.kind}`, { version: old.version }, { version: saved.version });
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
    design: z.string().max(80).optional(),
    template: z.string().max(100_000).optional(),
    blocks: z.unknown().optional(),
    meta: z.string().max(20_000).optional(),
    metaOverrides: metaOverridesSchema.optional(),
  });
  app.post('/api/admin/templates/preview', staff(async (req, reply, _admin, access) => {
    const body = previewSchema.parse(req.body);
    const company = findCompany(body.company);
    if (!company) return reply.code(404).send({ error: 'Unknown company' });
    if (!access.can(company.key)) return forbidden(reply);
    const design = designOf(company.key, body.design);
    if (!design) return reply.code(404).send({ error: 'Design not found' });
    let data: SignatureData = SAMPLE_PERSON;
    if (body.upn) {
      // Editors can preview as people of their own companies only (it shows that person's details).
      const user = await scopedUser(access, body.upn);
      if (!user) return reply.code(404).send({ error: 'User not found in directory' });
      data = signatureDataFor(user);
    }
    const template = body.blocks ? compileBlocks(blockDocSchema.parse(body.blocks), body.type === 'newMail' ? 'new' : 'reply') : body.template;
    const html = ctx.renderer.render({ company, type: body.type, data, settings: previewSettings(req), design, draft: { template, meta: body.meta, metaOverrides: body.metaOverrides } });
    return reply.type('text/html; charset=utf-8').send(html);
  }));

  // ───────────────────────────── Logo / image assets ─────────────────────────────

  const uploadsDir = (company: string) => path.join(ctx.env.dataDir, 'assets', company);
  const safeName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}\.(png|jpe?g|gif)$/i, 'File name: letters, digits, dot, dash; .png/.jpg/.gif');

  app.get('/api/admin/assets/:company', staff(async (req, reply, _admin, access) => {
    const { company } = req.params as { company: string };
    if (!findCompany(company)) return reply.code(404).send({ error: 'Unknown company' }); // also blocks ../ in the path below
    if (!access.can(company)) return forbidden(reply);
    const names = new Set<string>();
    for (const dir of [path.join(ctx.env.assetsDir, company), uploadsDir(company)]) {
      if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (safeName.safeParse(f).success) names.add(f);
    }
    const base = ctx.settings.get().publicUrl;
    return [...names].sort().map((name) => ({ name, url: `${base}/assets/${company}/${name}`, localUrl: `/assets/${company}/${name}` }));
  }));

  app.post('/api/admin/assets/:company', { bodyLimit: 1_000_000 }, staff(async (req, reply, admin, access) => {
    const { company } = req.params as { company: string };
    if (!findCompany(company)) return reply.code(404).send({ error: 'Unknown company' });
    if (!access.can(company)) return forbidden(reply);
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
      publicUrl: originSchema(false),
      defaultCompany: z.string(),
      adminGroupId: optionalGuid,
      adminGroupName: z.string().trim().max(256),
      pilotGroupId: optionalGuid,
      pilotGroupName: z.string().trim().max(256),
      excludeGroupId: optionalGuid,
      excludeGroupName: z.string().trim().max(256),
      selfServiceEnabled: z.boolean(),
      selfServiceFields: z.array(z.enum(['jobTitleEn', 'hideMobile', 'mobilePhone', 'jobTitleLv'])),
      language: z.enum(['lv', 'en', 'bilingual']),
      allowedOrigins: z.array(originSchema(true)).max(10),
      setupStep: z.number().int().min(0).max(20),
    })
    .partial();

  app.put('/api/admin/settings', guard(async (req, reply, admin) => {
    const patch = generalSchema.parse(req.body);
    if (patch.defaultCompany && !findCompany(patch.defaultCompany)) return reply.code(400).send({ error: 'Unknown default company' });
    const before = ctx.settings.get();
    ctx.settings.update(patch);
    if (patch.adminGroupId !== undefined || patch.pilotGroupId !== undefined || patch.excludeGroupId !== undefined) ctx.resolver.clearCache();
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
    // A new password signs the account out everywhere, except the session that changed its own password.
    const own = admin.kind === 'local' && admin.adminId === id && req.cookies[SESSION_COOKIE];
    if (own) ctx.repo.deleteSessionsForAdminExcept(id, hashSessionId(req.cookies[SESSION_COOKIE]!, ctx.sessionKey));
    else ctx.repo.deleteSessionsForAdmin(id);
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

/**
 * A bare origin ("https://sig.tenax.lv"): https only (http://localhost allowed where noted), no credentials, path,
 * query or fragment. Stored normalised, so it can't carry markup into the manifest, CORS or the well-known file.
 */
function originSchema(allowLocalHttp: boolean) {
  return z
    .string()
    .trim()
    .max(200)
    .transform((v, c) => {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        c.addIssue({ code: 'custom', message: 'Enter a full address like https://sig.tenax.lv' });
        return z.NEVER;
      }
      const localHttp = allowLocalHttp && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
      if ((u.protocol !== 'https:' && !localHttp) || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) {
        c.addIssue({ code: 'custom', message: 'Use https:// and a host name only, e.g. https://sig.tenax.lv' });
        return z.NEVER;
      }
      return u.origin;
    });
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
