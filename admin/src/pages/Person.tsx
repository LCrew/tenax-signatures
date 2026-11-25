import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useCompanies, useDebounced, useToast } from '../lib/hooks';
import { FIELD_LABELS, LOCALE_NAMES, SKIP_REASONS, STANDARD_GREETINGS, ownTitleLabel, type ComposeType, type Design, type Overrides, type PersonLanguage, type UserDetail } from '../lib/types';
import { CompanyName, ErrorNote, Field, Loading, Modal, PageHead, timeAgo } from '../components/ui';
import { LetterPreview } from '../components/LetterPreview';
import { t, tn, tx } from '../lib/i18n';

const TEXT_FIELDS = ['displayName', 'jobTitleLv', 'jobTitleEn', 'mobilePhone', 'officePhone', 'department', 'address'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

function entraValue(u: UserDetail, f: TextField): string | null {
  switch (f) {
    case 'displayName': return u.entra.displayName;
    case 'jobTitleLv': return u.entra.jobTitle;
    case 'jobTitleEn': return null;
    case 'mobilePhone': return u.entra.mobilePhone;
    case 'officePhone': return u.entra.businessPhones?.[0] ?? null;
    case 'department': return u.entra.department;
    case 'address': return u.defaultAddress || null; // the company's, from Brand and footer
  }
}

export function Person() {
  const { upn = '' } = useParams();
  const { session } = useApp();
  const toast = useToast();
  const user = useAsync(() => api.get<UserDetail>(`/api/admin/users/${encodeURIComponent(upn)}`), [upn]);
  const { companies } = useCompanies();
  const [draft, setDraft] = useState<Overrides>({});
  const [type, setType] = useState<ComposeType>('newMail');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user.data) setDraft(pickOverrides(user.data.overrides));
  }, [user.data]);

  const saved = useMemo(() => pickOverrides(user.data?.overrides ?? null), [user.data]);
  const dirty = JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(saved));
  const debounced = useDebounced(draft, 300);
  const preview = useAsync(
    () => (user.data ? api.post<string>(`/api/admin/users/${encodeURIComponent(upn)}/preview-draft`, { type, overrides: normalize(debounced) }) : Promise.resolve('')),
    [upn, type, JSON.stringify(debounced), !!user.data],
  );

  if (user.error) return <ErrorNote error={user.error} retry={user.reload} />;
  if (!user.data) return <Loading />;
  const u = user.data;
  const company = companies.find((c) => c.key === u.company);

  async function save() {
    setSaving(true);
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(upn)}/overrides`, normalize(draft));
      toast(t('Corrections saved. Outlook picks them up on the next new message.'));
      await user.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const set = (k: keyof Overrides, v: unknown) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <>
      <Link to="/people" className="btn ghost sm" style={{ marginBottom: 12, paddingLeft: 0 }}>
        <ArrowLeft size={14} /> {t('People')}
      </Link>
      <PageHead
        title={u.displayName ?? u.upn}
        lead={
          <span className="row" style={{ gap: 8 }}>
            {u.upn} <CompanyName name={u.companyName} color={company?.color} />
            {u.isAdmin && <span className="tag action">{t('Admin')}</span>}
            {u.isPilot && <span className="tag">{t('Pilot')}</span>}
          </span>
        }
      />
      {u.skipped.length > 0 && <SkippedNote user={u} />}
      {session?.isAdmin && (u.skipped.length === 0 || u.excluded) && <ExclusionBar user={u} onChanged={user.reload} />}
      {u.conflict && (
        <div className="callout warn" style={{ marginBottom: 20 }}>
          {tn(u.candidates.length, "In {n} company group ({groups}). Using {company} because it's higher in the priority list.", "In {n} company groups ({groups}). Using {company} because it's higher in the priority list.", { groups: u.candidates.join(', '), company: u.companyName })}{' '}
          {session?.isAdmin ? t('Pick their company below to settle it for this person, or remove them from the other group in AD.') : t('IT can settle this by choosing their company.')}
        </div>
      )}
      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h3>{t('Signature details')}</h3>
            <span className="spacer" />
            <span className="xs muted">{t('Empty means "use Entra ID"')}</span>
          </div>
          <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className="field-row">
              <label className="k" htmlFor="f-language">
                {t('Signature language')}
              </label>
              <div>
                <select id="f-language" value={draft.language ?? ''} onChange={(e) => set('language', (e.target.value || null) as PersonLanguage | null)}>
                  <option value="">{t('Latvian (company language)')}</option>
                  {(['et', 'lt'] as PersonLanguage[]).map((l) => (
                    <option key={l} value={l}>
                      {t(LOCALE_NAMES[l])}
                    </option>
                  ))}
                </select>
                <div className="entra">
                  {draft.language
                    ? t('{language} job title with the English one under it (except on English-only designs), and the {language} closing line and banner from Designs › Languages and banners. Company details stay as in Latvia.', { language: t(LOCALE_NAMES[draft.language]) })
                    : t('For Estonian and Lithuanian colleagues: they get their own-language job title, closing line and banner.')}
                </div>
              </div>
            </div>
            {TEXT_FIELDS.map((f) => {
              const ev = entraValue(u, f);
              const ov = (draft[f] as string | null | undefined) ?? '';
              return (
                <div className="field-row" key={f}>
                  <label className="k" htmlFor={`f-${f}`}>
                    {f === 'jobTitleLv' ? ownTitleLabel(draft.language) : t(FIELD_LABELS[f])}
                  </label>
                  <div>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input id={`f-${f}`} type="text" value={ov} placeholder={ev ?? (f === 'jobTitleEn' ? t('Not in Entra; set here') : f === 'address' ? t('No company address: line is left out') : t('Empty in Entra: line is left out'))} onChange={(e) => set(f, e.target.value)} />
                      {ov && (
                        <button type="button" className="btn ghost sm" onClick={() => set(f, null)} title={f === 'address' ? t('Use the company address') : t('Use the Entra value')}>
                          <Undo2 size={14} />
                        </button>
                      )}
                    </div>
                    <div className="entra">
                      {ov ? <span className="tag action">{t('Correction')}</span> : ev ? <span className="tag">{f === 'address' ? t('Company address') : t('From Entra')}</span> : f !== 'address' && <span className="tag danger">{t('Missing')}</span>}
                      {ov && ev && <span>{f === 'address' ? t('Company address') : t('Entra says')}: {ev}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="field-row">
              <span className="k">{t('Email')}</span>
              <div style={{ paddingTop: 8 }}>
                {u.entra.mail ?? u.upn} <span className="xs muted">· {t('always from Entra')}</span>
              </div>
            </div>
            {session?.isAdmin && <div className="field-row">
              <label className="k" htmlFor="f-company">{t('Company')}</label>
              <div>
                <select id="f-company" value={draft.company ?? ''} onChange={(e) => set('company', e.target.value || null)}>
                  <option value="">{t('From group membership')}</option>
                  {companies.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
                <div className="entra">
                  {u.companySource === 'group'
                    ? u.candidates.length > 1
                      ? tn(u.candidates.length, 'From group membership (in {n} company group). Pick a company to override it; their signature then uses that company’s designs.', 'From group membership (in {n} company groups). Pick a company to override it; their signature then uses that company’s designs.')
                      : t('From group membership. Pick a company to override it; their signature then uses that company’s designs.')
                    : u.companySource === 'default'
                      ? t('In no company group, so the default company is used. Pick a company to set it.')
                      : u.candidates.length
                        ? t('Set by an admin, overriding group membership (groups: {groups}). Choose “From group membership” to undo.', { groups: u.candidates.join(', ') })
                        : t('Set by an admin, overriding group membership. Choose “From group membership” to undo.')}
                </div>
              </div>
            </div>}
            <DesignRow user={u} draft={draft} set={set} />
            <div className="field-row">
              <label className="k" htmlFor="f-greeting">{t('Closing line')}</label>
              <div>
                <select
                  id="f-greeting-mode"
                  aria-label={t('Closing line')}
                  value={draft.greeting == null ? 'default' : draft.greeting === '' ? 'none' : 'own'}
                  onChange={(e) => set('greeting', e.target.value === 'default' ? null : e.target.value === 'none' ? '' : draft.greeting || (draft.language ? STANDARD_GREETINGS[draft.language] : 'Ar cieņu,'))}
                >
                  <option value="default">{t('Company default')}{draft.language ? ` (${t(LOCALE_NAMES[draft.language])})` : ''}</option>
                  <option value="own">{t('Own text')}</option>
                  <option value="none">{t('None')}</option>
                </select>
                {draft.greeting != null && draft.greeting !== '' && (
                  <input id="f-greeting" type="text" maxLength={120} style={{ marginTop: 8 }} value={draft.greeting} onChange={(e) => set('greeting', e.target.value)} />
                )}
                <div className="entra">{t('The person can also change this themselves in My signature.')}</div>
              </div>
            </div>
            <div className="field-row">
              <span className="k">{t('Privacy')}</span>
              <label className="check" style={{ paddingTop: 8 }}>
                <input type="checkbox" checked={draft.hideMobile === true} onChange={(e) => set('hideMobile', e.target.checked ? true : null)} />
                {t('Leave the mobile number out of the signature')}
              </label>
            </div>
          </div>
          <div className="panel-body row" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="xs muted">
              {u.overrides?.updatedAt ? t('Last corrected {when} by {who}', { when: timeAgo(u.overrides.updatedAt), who: u.overrides.updatedBy ?? '' }) : t('No corrections yet')}
            </span>
            <span className="spacer" />
            <button className="btn ghost" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
              {t('Discard')}
            </button>
            <button className="btn primary" disabled={!dirty || saving} onClick={save}>
              {saving ? t('Saving…') : t('Save corrections')}
            </button>
          </div>
        </section>

        <div className="sticky stack">
          <LetterPreview html={preview.data ?? null} error={preview.error?.message} loading={preview.loading} type={type} onTypeChange={setType} from={{ name: draft.displayName || u.displayName || u.upn, email: u.entra.mail ?? u.upn }} />
          {dirty && <p className="xs muted">{t('Preview shows unsaved changes.')}</p>}
          {u.history.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h3>{t('History')}</h3>
              </div>
              <ul className="history panel-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
                {u.history.map((h) => (
                  <li key={h.id} style={{ gridTemplateColumns: '1fr auto' }}>
                    <span>
                      {h.action === 'overrides.self' ? t('Edited by themselves') : t('Corrected by {who}', { who: h.actor })}
                      <span className="xs muted"> · {changedFields(h.before, h.after).join(', ') || t('no field changes')}</span>
                    </span>
                    <span className="xs muted">{timeAgo(h.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}

function pickOverrides(o: Overrides | null): Overrides {
  if (!o) return {};
  const { displayName, jobTitleLv, jobTitleEn, mobilePhone, officePhone, department, company, hideMobile, design, designLocked, greeting, address, language } = o;
  return { displayName, jobTitleLv, jobTitleEn, mobilePhone, officePhone, department, company, hideMobile, design, designLocked, greeting, address, language };
}

/** Empty strings mean "no correction". */
function normalize(o: Overrides): Overrides {
  const out: Record<string, unknown> = {};
  for (const k of ['displayName', 'jobTitleLv', 'jobTitleEn', 'mobilePhone', 'officePhone', 'department', 'company', 'address'] as const) {
    const v = o[k];
    out[k] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  out.hideMobile = o.hideMobile === true ? true : null;
  out.design = o.design || null;
  out.greeting = o.greeting == null ? null : o.greeting.trim();
  out.designLocked = !!o.design && o.designLocked === true;
  out.language = o.language || null;
  return out as Overrides;
}

function changedFields(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  return Object.keys(FIELD_LABELS)
    .filter((k) => (b[k] ?? null) !== (a[k] ?? null))
    .map((k) => t(FIELD_LABELS[k]).toLowerCase());
}

/** Accounts Microsoft 365 keeps out of signatures (People › Skipped): why, and what would change that. */
function SkippedNote({ user: u }: { user: UserDetail }) {
  if (u.sharedMailbox) {
    return (
      <div className="callout" style={{ marginBottom: 20 }}>
        {tx("A shared mailbox, so it's not in People ({reasons}). That's expected: the signature people get when sending from it is set under {link}.", {
          reasons: u.skipped.map((r) => t(SKIP_REASONS[r].label).toLowerCase()).join(', '),
          link: <Link to="/mailboxes">{t('Shared mailboxes')}</Link>,
        })}
      </div>
    );
  }
  return (
    <div className="callout warn" style={{ marginBottom: 20 }}>
      {t('Not in People: Microsoft 365 keeps this account out of signatures.')}
      <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {u.skipped.map((r) => (
          <li key={r}>
            <strong>{t(SKIP_REASONS[r].label)}.</strong> {t(SKIP_REASONS[r].fix)}
            {r === 'mailboxOff' && u.entra.exchangeStatus && ` ${t('Microsoft 365 reports the plan as “{status}”.', { status: u.entra.exchangeStatus })}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** IT only: leave an account (service, test, room mailbox…) out of signatures and all lists, or include it again. */
function ExclusionBar({ user: u, onChanged }: { user: UserDetail; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const set = async (excluded: boolean) => {
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(u.upn)}/exclusion`, { excluded, reason: reason || undefined });
      toast(excluded ? t('{name} is excluded from signatures', { name: u.displayName ?? u.upn }) : t('{name} gets a signature again', { name: u.displayName ?? u.upn }));
      setOpen(false);
      setReason('');
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  if (u.excluded) {
    return (
      <div className="callout row" style={{ marginBottom: 20 }}>
        <span style={{ flex: '1 1 260px' }}>
          {u.excluded.by === 'group'
            ? t('Excluded from signatures because this account is in the exclusion group. Remove it from that group in Entra to include it again.')
            : u.excluded.reason
              ? t('Excluded from signatures ({reason}) by {who}, {when}. Outlook inserts nothing for this account.', { reason: u.excluded.reason, who: u.excluded.excludedBy, when: timeAgo(u.excluded.excludedAt) })
              : t('Excluded from signatures by {who}, {when}. Outlook inserts nothing for this account.', { who: u.excluded.excludedBy, when: timeAgo(u.excluded.excludedAt) })}
        </span>
        {u.excluded.by === 'manual' && (
          <button className="btn sm" onClick={() => set(false)}>
            {t('Include again')}
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="row" style={{ marginBottom: 16, marginTop: -8 }}>
        <button className="btn ghost sm" onClick={() => setOpen(true)}>
          <Ban size={14} /> {t('Exclude from signatures')}
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={t('Exclude {name}?', { name: u.displayName ?? u.upn })}>
        <p>
          {t('For service accounts, scanners, test or room mailboxes. The account disappears from People, the Overview and the report, and Outlook inserts no signature for it. You can include it again from People › Excluded.')}
        </p>
        <Field label={t('Reason')} hint={t('Optional, shown in People › Excluded')}>
          <input type="text" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. Scanner mailbox')} />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setOpen(false)}>
            {t('Cancel')}
          </button>
          <button className="btn primary" onClick={() => set(true)}>
            {t('Exclude from signatures')}
          </button>
        </div>
      </Modal>
    </>
  );
}

/** Which design this person gets: company default, their own choice, or one an admin sets (optionally locked). */
function DesignRow({ user: u, draft, set }: { user: UserDetail; draft: Overrides; set: (k: keyof Overrides, v: unknown) => void }) {
  const designs = useAsync(() => api.get<Design[]>(`/api/admin/designs?company=${encodeURIComponent(u.company)}`), [u.company]);
  const list = designs.data ?? [];
  if (list.length < 2) return null;
  const chosen = u.overrides?.chosenDesign ? list.find((d) => d.id === u.overrides!.chosenDesign) : undefined;
  const sourceText: Record<string, string> = {
    locked: t('Set by an admin and locked'),
    chosen: t('Their own choice'),
    assigned: t('Set by an admin; they may change it'),
    default: t('Company default'),
  };
  return (
    <div className="field-row">
      <label className="k" htmlFor="f-design">
        {t('Signature design')}
      </label>
      <div>
        <select id="f-design" value={draft.design ?? ''} onChange={(e) => set('design', e.target.value || null)}>
          <option value="">{chosen ? t('Their own choice ({name})', { name: chosen.name }) : t('Company default / their own choice')}</option>
          {list.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.isDefault ? ` (${t('default')})` : ''}
              {d.purpose === 'service' ? ` (${t('service')})` : ''}
            </option>
          ))}
        </select>
        {draft.design && (
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={draft.designLocked === true} onChange={(e) => set('designLocked', e.target.checked)} />
            {t('Lock it (they can’t switch in Outlook or My signature)')}
          </label>
        )}
        <div className="entra">
          {t('Now: {design}', { design: u.design?.name ?? '' })} · {sourceText[u.design?.source ?? 'default']}
        </div>
      </div>
    </div>
  );
}
