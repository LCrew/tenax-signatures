import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { actorOf, requireUser } from '../auth/plugin.js';
import { findAsset } from '../services/assets.js';
import { inlineImages, type ImageSource } from '../services/inline.js';
import { companyAddress, signatureDataFor, signatureDataForMailbox } from '../services/renderer.js';
import { applyOverrides } from '../services/designs.js';
import type { ComposeType, Design, Overrides, ResolvedUser, SharedMailbox } from '../types.js';

const typeSchema = z.enum(['newMail', 'reply', 'forward']).default('newMail');

export function signatureRoutes(app: FastifyInstance, ctx: AppContext) {
  /** The person's design, or another one they asked for if they're allowed to use it (Outlook switch button). */
  function designFor(user: ResolvedUser, requested?: string): Design | undefined {
    const id = requested && user.allowedDesigns.some((d) => d.id === requested) ? requested : user.design.id;
    return ctx.repo.getDesign(id);
  }

  /** Shared mailboxes: their own design, else the company's Service design, else the default. */
  function mailboxDesign(mailbox: SharedMailbox): Design | undefined {
    const designs = ctx.repo.listDesigns(mailbox.company);
    return designs.find((d) => d.id === mailbox.design) ?? designs.find((d) => d.purpose === 'service') ?? designs.find((d) => d.isDefault);
  }

  /** Image bytes behind our own image URLs, for embedding them in the email. */
  const imageSource: ImageSource = {
    asset: (company, file) => {
      const full = findAsset(ctx.env, company, file);
      return full ? fs.readFileSync(full) : null;
    },
    signatureImage: (hash) => {
      try {
        return ctx.images.png(hash);
      } catch {
        return null; // stays a linked image
      }
    },
  };

  /**
   * Rendered signature for THE CALLER. The only user identity input is the validated token.
   * ?inline=1 (add-in builds that can attach images): JSON { html, images } where the logo / image signature is a
   * cid: reference to an image the add-in attaches, so replies from Outlook for Mac keep it. Otherwise plain HTML.
   */
  app.get('/api/signature', async (req, reply) => {
    const q = req.query as { type?: string; from?: string; design?: string; inline?: string };
    const type = typeSchema.safeParse(q.type);
    if (!type.success) return reply.code(400).send({ error: 'type must be newMail, reply or forward' });

    const user = await requireUser(req, reply, ctx);
    if (!user) return;
    const settings = ctx.settings.get();
    const companies = ctx.repo.listCompanies();
    const send = (html: string) => {
      reply.header('Cache-Control', 'no-store');
      if (q.inline === '1') return reply.send(inlineImages(html, settings.publicUrl, imageSource));
      return reply.type('text/html; charset=utf-8').send(html);
    };

    // OnMessageFromChanged: only switch identity for configured shared mailboxes; anything else
    // falls back to the caller's own signature.
    const from = q.from?.trim().toLowerCase();
    let mailboxEmail: string | null = null;
    if (from && from !== user.upn && from !== user.entra.mail?.toLowerCase()) {
      const mailbox = ctx.repo.getSharedMailbox(from);
      const company = mailbox && companies.find((c) => c.key === mailbox.company);
      // Personal signature from a shared address (e.g. answering from support@ as yourself).
      if (mailbox?.signature === 'senderWithMailboxEmail') mailboxEmail = mailbox.email;
      if (mailbox && company && (mailbox.signature ?? 'mailbox') === 'mailbox') {
        return send(ctx.renderer.render({ company, type: type.data as ComposeType, data: signatureDataForMailbox(mailbox), settings, design: mailboxDesign(mailbox) }));
      }
    }

    // Excluded accounts (service accounts…) get no signature at all.
    if (user.excluded) return reply.code(204).header('Cache-Control', 'no-store').send();
    const company = companies.find((c) => c.key === user.company);
    if (!company) return reply.code(500).send({ error: `Company "${user.company}" is not configured` });
    try {
      const data = { ...signatureDataFor(user), ...(mailboxEmail ? { email: mailboxEmail } : {}) };
      return send(ctx.renderer.render({ company, type: type.data as ComposeType, data, settings, design: designFor(user, q.design) }));
    } catch (e) {
      // A broken design must never break composing: insert nothing (204) and leave a trace for IT.
      req.log.error({ err: e, company: company.key }, 'signature render failed');
      ctx.repo.addTelemetry({ upn: user.upn, event: 'server', stage: 'render', message: String((e as Error).message).slice(0, 300), host: null, platform: null });
      return reply.code(204).send();
    }
  });

  /** Self-service: the signed-in person's own data (Microsoft sign-in, never a upn parameter). */
  app.get('/api/me', async (req, reply) => {
    const user = await requireUser(req, reply, ctx);
    if (!user) return;
    const s = ctx.settings.get();
    const company = ctx.repo.listCompanies().find((c) => c.key === user.company);
    return {
      upn: user.upn,
      company: user.company,
      companyName: company?.displayName ?? user.company,
      fields: user.fields,
      sources: user.sources,
      entra: {
        displayName: user.entra.displayName,
        jobTitle: user.entra.jobTitle,
        mobilePhone: user.entra.mobilePhone,
        officePhone: user.entra.businessPhones?.[0] ?? null,
        department: user.entra.department,
      },
      overrides: user.overrides
        ? Object.fromEntries(s.selfServiceFields.map((f) => [f, (user.overrides as any)[f] ?? null]))
        : {},
      isAdmin: user.isAdmin,
      excluded: !!user.excluded,
      design: user.design,
      designLocked: user.designLocked,
      // Closing line: theirs (null = default, '' = none) and the default it falls back to.
      greeting: user.fields.greeting,
      defaultGreeting: defaultGreeting(user),
      // Address line: the company's, unless they set their own (overrides.address).
      defaultAddress: companyAddress(ctx.repo, user.company),
      designs: user.allowedDesigns.map((d) => ({ ...d, selected: d.id === user.design.id })),
      selfService: { enabled: s.selfServiceEnabled, fields: s.selfServiceFields },
    };
  });

  /** Checks a self-service patch: feature on, only allowed fields, valid values. */
  function parseSelfPatch(raw: unknown): { ok: true; data: Partial<Overrides> } | { ok: false; status: number; error: string } {
    const s = ctx.settings.get();
    if (!s.selfServiceEnabled) return { ok: false, status: 403, error: 'Self-service editing is turned off' };
    const body = z.record(z.string(), z.unknown()).safeParse(raw ?? {});
    if (!body.success) return { ok: false, status: 400, error: 'Expected a JSON object' };
    const disallowed = Object.keys(body.data).filter((k) => !s.selfServiceFields.includes(k as any));
    if (disallowed.length) return { ok: false, status: 403, error: `You can't change: ${disallowed.join(', ')}` };
    const parsed = overridePatchSchema.safeParse(body.data);
    if (!parsed.success) return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Invalid values' };
    return { ok: true, data: parsed.data };
  }

  /** Previews load images from the host the person is browsing (works before DNS/TLS is live). */
  const previewSettings = (req: { protocol: string; host: string }) => ({ ...ctx.settings.get(), publicUrl: `${req.protocol}://${req.host}` });

  app.get('/api/me/preview', async (req, reply) => {
    const requestedDesign = (req.query as any).design as string | undefined;
    const type = typeSchema.safeParse((req.query as any).type);
    if (!type.success) return reply.code(400).send({ error: 'type must be newMail, reply or forward' });
    const user = await requireUser(req, reply, ctx);
    if (!user) return;
    const company = ctx.repo.listCompanies().find((c) => c.key === user.company);
    if (!company) return reply.code(500).send({ error: `Company "${user.company}" is not configured` });
    const html = ctx.renderer.render({ company, type: type.data as ComposeType, data: signatureDataFor(user), settings: previewSettings(req), design: designFor(user, requestedDesign) });
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  /** The closing line the person's design would use without a personal one. */
  function defaultGreeting(user: ResolvedUser): string {
    const design = ctx.repo.getDesign(user.design.id);
    const meta = applyOverrides(ctx.repo.latestTemplate(user.company, 'meta')?.content ?? '{}', design?.metaOverrides);
    try {
      return String(JSON.parse(meta).greeting ?? '');
    } catch {
      return '';
    }
  }

  /** Everyone may set their own closing line (a personal preference, like choosing a design). */
  app.put('/api/me/greeting', async (req, reply) => {
    const body = greetingBodySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Keep the closing line to one line of at most 120 characters' });
    const user = await requireUser(req, reply, ctx);
    if (!user) return;
    const before = ctx.repo.getOverrides(user.upn);
    const next: Overrides = { ...(before ?? { upn: user.upn }), upn: user.upn, greeting: body.data.greeting, updatedBy: actorOf(req.identity), updatedAt: new Date().toISOString() };
    ctx.repo.saveOverrides(next);
    ctx.repo.audit(actorOf(req.identity), 'greeting.self', user.upn, { greeting: before?.greeting ?? null }, { greeting: body.data.greeting });
    return { ok: true };
  });

  /** Designs the caller may use (Outlook task pane / My signature). */
  app.get('/api/me/designs', async (req, reply) => {
    const user = await requireUser(req, reply, ctx);
    if (!user) return;
    return {
      locked: user.designLocked,
      designs: user.allowedDesigns.map((d) => ({ ...d, current: d.id === user.design.id })),
    };
  });

  /** The person picks their default design: selectable person designs of their company only, never when locked. */
  app.put('/api/me/design', async (req, reply) => {
    const body = z.object({ design: z.string().max(80).nullable() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Send {"design": "<id>"} or {"design": null}' });
    const user = await requireUser(req, reply, ctx);
    if (!user) return;
    if (user.designLocked) return reply.code(403).send({ error: 'Your signature was set by an administrator' });
    if (body.data.design) {
      const d = ctx.repo.getDesign(body.data.design);
      if (!d || d.company !== user.company || d.purpose !== 'person' || !d.selectable) {
        return reply.code(403).send({ error: 'You can’t choose that signature' });
      }
    }
    const before = ctx.repo.getOverrides(user.upn);
    const next: Overrides = { ...(before ?? { upn: user.upn }), upn: user.upn, chosenDesign: body.data.design, updatedBy: actorOf(req.identity), updatedAt: new Date().toISOString() };
    ctx.repo.saveOverrides(next);
    ctx.repo.audit(actorOf(req.identity), 'design.self', user.upn, { design: before?.chosenDesign ?? null }, { design: body.data.design });
    return { ok: true };
  });

  /** Preview with unsaved self-service edits. Same rules as saving; nothing is stored. */
  app.post('/api/me/preview-draft', async (req, reply) => {
    const body = z
      .object({ type: typeSchema, overrides: z.unknown().optional(), design: z.string().max(80).optional(), greeting: greetingSchema.optional() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid preview request' });
    const user = await requireUser(req, reply, ctx);
    if (!user) return;
    // Corrections follow the self-service rules; a closing line (or no changes) needs no self-service.
    const raw = body.data.overrides;
    const hasCorrections = raw != null && typeof raw === 'object' && Object.keys(raw as object).length > 0;
    const patch = hasCorrections ? parseSelfPatch(raw) : ({ ok: true, data: {} } as const);
    if (!patch.ok) return reply.code(patch.status).send({ error: patch.error });
    const company = ctx.repo.listCompanies().find((c) => c.key === user.company);
    if (!company) return reply.code(500).send({ error: `Company "${user.company}" is not configured` });
    const draftOverrides = { ...(user.overrides ?? { upn: user.upn }), ...patch.data, upn: user.upn, ...(body.data.greeting !== undefined ? { greeting: body.data.greeting } : {}) };
    const draft = ctx.resolver.build(user.entra, await ctx.resolver.groupIds(user.oid), draftOverrides);
    const html = ctx.renderer.render({ company, type: body.data.type as ComposeType, data: signatureDataFor(draft), settings: previewSettings(req), design: designFor(user, body.data.design) });
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.put('/api/me/overrides', async (req, reply) => {
    const user = await requireUser(req, reply, ctx);
    if (!user) return;
    const patch = parseSelfPatch(req.body);
    if (!patch.ok) return reply.code(patch.status).send({ error: patch.error });
    const parsed = { data: patch.data };

    const before = ctx.repo.getOverrides(user.upn);
    const next: Overrides = { ...(before ?? { upn: user.upn }), ...parsed.data, upn: user.upn, updatedBy: actorOf(req.identity), updatedAt: new Date().toISOString() };
    ctx.repo.saveOverrides(next);
    ctx.repo.audit(actorOf(req.identity), 'overrides.self', user.upn, before, next);
    return { ok: true };
  });

  const telemetrySchema = z.object({
    event: z.string().max(64),
    stage: z.string().max(64).optional(),
    message: z.string().max(1000).optional(),
    host: z.string().max(64).optional(),
    platform: z.string().max(64).optional(),
    composeType: z.string().max(32).optional(),
  });

  /** Add-in failure telemetry. Unauthenticated by design (the failure may be auth itself), so it's tightly rate limited. */
  app.post('/api/telemetry', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = telemetrySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid telemetry' });
    const upn = req.identity && req.identity.kind !== 'local' ? req.identity.upn : null;
    // Client-reported and unauthenticated: scrub email addresses (some AADSTS messages embed the UPN) and keep
    // the log line short so anonymous senders can't fill the disk.
    const scrub = (v?: string) => v?.replace(/[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}/gi, '[email]') ?? null;
    ctx.repo.addTelemetry({
      upn,
      event: body.data.event,
      stage: [body.data.stage, body.data.composeType].filter(Boolean).join('/') || null,
      message: scrub(body.data.message),
      host: body.data.host ?? null,
      platform: body.data.platform ?? null,
    });
    req.log.info({ event: body.data.event, stage: body.data.stage, upn }, 'add-in reported a failure');
    return reply.code(204).send();
  });
}

const nullableText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .transform((v) => (v == null || v.trim() === '' ? null : v.trim()));

/** One line, plain text; null = use the company/design closing line, '' = no closing line. */
export const greetingSchema = z.union([
  z.null(),
  z
    .string()
    .max(120)
    .transform((v) => v.replace(/[\r\n\t]+/g, ' ').trim()),
]);
const greetingBodySchema = z.object({ greeting: greetingSchema }).strict();

export const overridePatchSchema = z
  .object({
    displayName: nullableText(120),
    jobTitleLv: nullableText(160),
    jobTitleEn: nullableText(160),
    mobilePhone: nullableText(40).refine((v) => v == null || /^[\d\s+()-]{5,40}$/.test(v), 'Phone numbers may only contain digits, spaces, +, ( ) and -'),
    officePhone: nullableText(40).refine((v) => v == null || /^[\d\s+()-]{5,40}$/.test(v), 'Phone numbers may only contain digits, spaces, +, ( ) and -'),
    department: nullableText(120),
    company: nullableText(64),
    hideMobile: z.union([z.boolean(), z.null()]),
    // One line: a pasted multi-line address becomes "Street 1, City".
    address: nullableText(200).transform((v) => (v == null ? null : v.replace(/\s*[\r\n]+\s*/g, ', ').replace(/\t+/g, ' '))),
  })
  .partial()
  .strict();
