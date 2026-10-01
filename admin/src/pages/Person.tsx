import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useCompanies, useDebounced, useToast } from '../lib/hooks';
import { FIELD_LABELS, type ComposeType, type Design, type Overrides, type UserDetail } from '../lib/types';
import { CompanyName, ErrorNote, Field, Loading, Modal, PageHead, timeAgo } from '../components/ui';
import { LetterPreview } from '../components/LetterPreview';

const TEXT_FIELDS = ['displayName', 'jobTitleLv', 'jobTitleEn', 'mobilePhone', 'officePhone', 'department'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

function entraValue(u: UserDetail, f: TextField): string | null {
  switch (f) {
    case 'displayName': return u.entra.displayName;
    case 'jobTitleLv': return u.entra.jobTitle;
    case 'jobTitleEn': return null;
    case 'mobilePhone': return u.entra.mobilePhone;
    case 'officePhone': return u.entra.businessPhones?.[0] ?? null;
    case 'department': return u.entra.department;
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
      toast('Corrections saved. Outlook picks them up on the next new message.');
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
        <ArrowLeft size={14} /> People
      </Link>
      <PageHead
        title={u.displayName ?? u.upn}
        lead={
          <span className="row" style={{ gap: 8 }}>
            {u.upn} <CompanyName name={u.companyName} color={company?.color} />
            {u.isAdmin && <span className="tag action">Admin</span>}
            {u.isPilot && <span className="tag">Pilot</span>}
          </span>
        }
      />
      {session?.isAdmin && <ExclusionBar user={u} onChanged={user.reload} />}
      {u.conflict && (
        <div className="callout warn" style={{ marginBottom: 20 }}>
          In {u.candidates.length} company groups ({u.candidates.join(', ')}). Using {u.companyName} because it's higher in
          the priority list. {session?.isAdmin ? 'Pick their company below to settle it for this person, or remove them from the other group in AD.' : 'IT can settle this by choosing their company.'}
        </div>
      )}
      <div className="split">
        <section className="panel">
          <div className="panel-head">
            <h3>Signature details</h3>
            <span className="spacer" />
            <span className="xs muted">Empty means "use Entra ID"</span>
          </div>
          <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {TEXT_FIELDS.map((f) => {
              const ev = entraValue(u, f);
              const ov = (draft[f] as string | null | undefined) ?? '';
              return (
                <div className="field-row" key={f}>
                  <label className="k" htmlFor={`f-${f}`}>
                    {FIELD_LABELS[f]}
                  </label>
                  <div>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input id={`f-${f}`} type="text" value={ov} placeholder={ev ?? (f === 'jobTitleEn' ? 'Not in Entra; set here' : 'Empty in Entra: line is left out')} onChange={(e) => set(f, e.target.value)} />
                      {ov && (
                        <button type="button" className="btn ghost sm" onClick={() => set(f, null)} title="Use the Entra value">
                          <Undo2 size={14} />
                        </button>
                      )}
                    </div>
                    <div className="entra">
                      {ov ? <span className="tag action">Correction</span> : ev ? <span className="tag">From Entra</span> : <span className="tag danger">Missing</span>}
                      {ov && ev && <span>Entra says: {ev}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="field-row">
              <span className="k">Email</span>
              <div style={{ paddingTop: 8 }}>
                {u.entra.mail ?? u.upn} <span className="xs muted">· always from Entra</span>
              </div>
            </div>
            {session?.isAdmin && <div className="field-row">
              <label className="k" htmlFor="f-company">Company</label>
              <div>
                <select id="f-company" value={draft.company ?? ''} onChange={(e) => set('company', e.target.value || null)}>
                  <option value="">From group membership</option>
                  {companies.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
                <div className="entra">
                  {u.companySource === 'group'
                    ? `From group membership${u.candidates.length > 1 ? ` (in ${u.candidates.length} company groups)` : ''}. Pick a company to override it; their signature then uses that company’s designs.`
                    : u.companySource === 'default'
                      ? 'In no company group, so the default company is used. Pick a company to set it.'
                      : `Set by an admin, overriding group membership${u.candidates.length ? ` (groups: ${u.candidates.join(', ')})` : ''}. Choose “From group membership” to undo.`}
                </div>
              </div>
            </div>}
            <DesignRow user={u} draft={draft} set={set} />
            <div className="field-row">
              <label className="k" htmlFor="f-greeting">Closing line</label>
              <div>
                <select
                  id="f-greeting-mode"
                  aria-label="Closing line"
                  value={draft.greeting == null ? 'default' : draft.greeting === '' ? 'none' : 'own'}
                  onChange={(e) => set('greeting', e.target.value === 'default' ? null : e.target.value === 'none' ? '' : draft.greeting || 'Ar cieņu,')}
                >
                  <option value="default">Company / design default</option>
                  <option value="own">Own text</option>
                  <option value="none">None</option>
                </select>
                {draft.greeting != null && draft.greeting !== '' && (
                  <input id="f-greeting" type="text" maxLength={120} style={{ marginTop: 8 }} value={draft.greeting} onChange={(e) => set('greeting', e.target.value)} />
                )}
                <div className="entra">The person can also change this themselves in My signature.</div>
              </div>
            </div>
            <div className="field-row">
              <span className="k">Privacy</span>
              <label className="check" style={{ paddingTop: 8 }}>
                <input type="checkbox" checked={draft.hideMobile === true} onChange={(e) => set('hideMobile', e.target.checked ? true : null)} />
                Leave the mobile number out of the signature
              </label>
            </div>
          </div>
          <div className="panel-body row" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="xs muted">
              {u.overrides?.updatedAt ? `Last corrected ${timeAgo(u.overrides.updatedAt)} by ${u.overrides.updatedBy}` : 'No corrections yet'}
            </span>
            <span className="spacer" />
            <button className="btn ghost" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
              Discard
            </button>
            <button className="btn primary" disabled={!dirty || saving} onClick={save}>
              {saving ? 'Saving…' : 'Save corrections'}
            </button>
          </div>
        </section>

        <div className="sticky stack">
          <LetterPreview html={preview.data ?? null} error={preview.error?.message} loading={preview.loading} type={type} onTypeChange={setType} from={{ name: draft.displayName || u.displayName || u.upn, email: u.entra.mail ?? u.upn }} />
          {dirty && <p className="xs muted">Preview shows unsaved changes.</p>}
          {u.history.length > 0 && (
            <section className="panel">
              <div className="panel-head">
                <h3>History</h3>
              </div>
              <ul className="history panel-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
                {u.history.map((h) => (
                  <li key={h.id} style={{ gridTemplateColumns: '1fr auto' }}>
                    <span>
                      {h.action === 'overrides.self' ? 'Edited by themselves' : `Corrected by ${h.actor}`}
                      <span className="xs muted"> · {changedFields(h.before, h.after).join(', ') || 'no field changes'}</span>
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
  const { displayName, jobTitleLv, jobTitleEn, mobilePhone, officePhone, department, company, hideMobile, design, designLocked, greeting } = o;
  return { displayName, jobTitleLv, jobTitleEn, mobilePhone, officePhone, department, company, hideMobile, design, designLocked, greeting };
}

/** Empty strings mean "no correction". */
function normalize(o: Overrides): Overrides {
  const out: Record<string, unknown> = {};
  for (const k of ['displayName', 'jobTitleLv', 'jobTitleEn', 'mobilePhone', 'officePhone', 'department', 'company'] as const) {
    const v = o[k];
    out[k] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  out.hideMobile = o.hideMobile === true ? true : null;
  out.design = o.design || null;
  out.greeting = o.greeting == null ? null : o.greeting.trim();
  out.designLocked = !!o.design && o.designLocked === true;
  return out as Overrides;
}

function changedFields(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  return Object.keys(FIELD_LABELS)
    .filter((k) => (b[k] ?? null) !== (a[k] ?? null))
    .map((k) => FIELD_LABELS[k].toLowerCase());
}

/** IT only: leave an account (service, test, room mailbox…) out of signatures and all lists, or include it again. */
function ExclusionBar({ user: u, onChanged }: { user: UserDetail; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const set = async (excluded: boolean) => {
    try {
      await api.put(`/api/admin/users/${encodeURIComponent(u.upn)}/exclusion`, { excluded, reason: reason || undefined });
      toast(excluded ? `${u.displayName ?? u.upn} is excluded from signatures` : `${u.displayName ?? u.upn} gets a signature again`);
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
            ? 'Excluded from signatures because this account is in the exclusion group. Remove it from that group in Entra to include it again.'
            : `Excluded from signatures${u.excluded.reason ? ` (${u.excluded.reason})` : ''} by ${u.excluded.excludedBy}, ${timeAgo(u.excluded.excludedAt)}. Outlook inserts nothing for this account.`}
        </span>
        {u.excluded.by === 'manual' && (
          <button className="btn sm" onClick={() => set(false)}>
            Include again
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <div className="row" style={{ marginBottom: 16, marginTop: -8 }}>
        <button className="btn ghost sm" onClick={() => setOpen(true)}>
          <Ban size={14} /> Exclude from signatures
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={`Exclude ${u.displayName ?? u.upn}?`}>
        <p>
          For service accounts, scanners, test or room mailboxes. The account disappears from People, the Overview and the
          report, and Outlook inserts no signature for it. You can include it again from People › Excluded.
        </p>
        <Field label="Reason" hint="Optional, shown in People › Excluded">
          <input type="text" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Scanner mailbox" />
        </Field>
        <div className="row end">
          <button className="btn ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => set(true)}>
            Exclude from signatures
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
    locked: 'Set by an admin and locked',
    chosen: 'Their own choice',
    assigned: 'Set by an admin; they may change it',
    default: 'Company default',
  };
  return (
    <div className="field-row">
      <label className="k" htmlFor="f-design">
        Signature design
      </label>
      <div>
        <select id="f-design" value={draft.design ?? ''} onChange={(e) => set('design', e.target.value || null)}>
          <option value="">{chosen ? `Their own choice (${chosen.name})` : 'Company default / their own choice'}</option>
          {list.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.isDefault ? ' (default)' : ''}
              {d.purpose === 'service' ? ' (service)' : ''}
            </option>
          ))}
        </select>
        {draft.design && (
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={draft.designLocked === true} onChange={(e) => set('designLocked', e.target.checked)} />
            Lock it (they can’t switch in Outlook or My signature)
          </label>
        )}
        <div className="entra">
          Now: {u.design?.name} · {sourceText[u.design?.source ?? 'default']}
        </div>
      </div>
    </div>
  );
}
