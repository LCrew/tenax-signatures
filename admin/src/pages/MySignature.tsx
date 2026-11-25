import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ClipboardCopy, LogOut, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useDebounced, useToast } from '../lib/hooks';
import { FIELD_LABELS, ownTitleLabel, type ComposeType, type PersonLanguage } from '../lib/types';
import { LetterPreview } from '../components/LetterPreview';
import { Mark, signOut } from '../components/Layout';
import { ErrorNote, Loading, Segmented } from '../components/ui';
import { msg, t, tx } from '../lib/i18n';

interface Me {
  upn: string;
  company: string;
  companyName: string;
  fields: Record<string, string | boolean | null>;
  sources: Record<string, 'override' | 'entra' | 'none'>;
  entra: { displayName: string | null; jobTitle: string | null; mobilePhone: string | null; officePhone: string | null; department: string | null };
  overrides: Record<string, string | boolean | null>;
  isAdmin: boolean;
  excluded?: boolean;
  design?: { id: string; name: string; purpose: string; source: string };
  designLocked?: boolean;
  designs?: { id: string; name: string; purpose: string; selected: boolean }[];
  greeting?: string | null;
  defaultGreeting?: string;
  /** The company's address line, used unless they set their own. */
  defaultAddress?: string;
  selfService: { enabled: boolean; fields: string[] };
}

/** English; translate where shown: t(HINTS[f]). */
const HINTS: Record<string, string> = {
  jobTitleEn: msg('Shown under your Latvian title'),
  jobTitleLv: msg('Replaces the title from the company directory'),
  mobilePhone: msg('Replaces the number from the company directory'),
  address: msg('Replaces the company address, e.g. if you work at another office'),
};

/** What each person sees after signing in with Microsoft: their own signature, and the parts they may change. */
export function MySignature({ embedded = false }: { embedded?: boolean }) {
  const { session } = useApp();
  const toast = useToast();
  const me = useAsync(() => api.get<Me>('/api/me'));
  const [draft, setDraft] = useState<Record<string, string | boolean | null>>({});
  const [type, setType] = useState<ComposeType>('newMail');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (me.data) setDraft(me.data.overrides ?? {});
  }, [me.data]);

  const editable = me.data?.selfService.enabled ? me.data.selfService.fields : [];
  const clean = useMemo(() => normalize(draft, editable), [draft, editable]);
  const saved = useMemo(() => normalize(me.data?.overrides ?? {}, editable), [me.data, editable]);
  const dirty = JSON.stringify(clean) !== JSON.stringify(saved);
  // Closing line: undefined = untouched, otherwise the draft value (null = default, '' = none).
  const [greetingDraft, setGreetingDraft] = useState<string | null | undefined>(undefined);
  useEffect(() => setGreetingDraft(undefined), [me.data]);
  const greetingDirty = greetingDraft !== undefined && greetingDraft !== (me.data?.greeting ?? null);
  const debounced = useDebounced(JSON.stringify({ clean, greetingDraft }), 300);
  const preview = useAsync(
    () =>
      !me.data
        ? Promise.resolve('')
        : dirty || greetingDirty
          ? api.post<string>('/api/me/preview-draft', { type, overrides: dirty ? clean : undefined, ...(greetingDirty ? { greeting: greetingDraft } : {}) })
          : api.get<string>(`/api/me/preview?type=${type}`),
    [type, debounced, !!me.data, dirty, greetingDirty, me.data?.design?.id, me.data?.greeting],
  );

  async function save() {
    setSaving(true);
    try {
      await api.put('/api/me/overrides', clean);
      toast(t('Saved. Your next new message in Outlook uses it.'));
      await me.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  // The real signature (absolute https:// image URLs) is fetched ahead of time: browsers only allow clipboard writes
  // inside the click itself, so there's no time to fetch it after the click.
  const real = useAsync(() => (me.data ? api.get<string>(`/api/signature?type=${type}`) : Promise.resolve('')), [type, me.data]);

  /** For Outlook clients without the add-in: copy the real signature as rich text to paste into signature settings. */
  function copy() {
    const done = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    };
    const fail = (e: unknown) => toast(t("Couldn't copy: {reason}. Select the preview and copy it instead.", { reason: (e as Error)?.message ?? t('the browser blocked it') }), 'error');
    const toText = (h: string) => new DOMParser().parseFromString(h, 'text/html').body.innerText;

    // Called synchronously in the click: a ClipboardItem may hold promises, so this also works if the prefetch
    // hasn't finished yet (Safari and Chrome both support that).
    const html: Promise<string> = real.data ? Promise.resolve(real.data) : api.get<string>(`/api/signature?type=${type}`);
    try {
      const item = new ClipboardItem({
        'text/html': html.then((h) => new Blob([h], { type: 'text/html' })),
        'text/plain': html.then((h) => new Blob([toText(h)], { type: 'text/plain' })),
      });
      navigator.clipboard.write([item]).then(done, () => (real.data && legacyCopy(real.data) ? done() : fail(new Error(t('the browser blocked clipboard access')))));
    } catch (e) {
      if (real.data && legacyCopy(real.data)) done();
      else fail(e);
    }
  }

  const body = me.data?.excluded ? (
    <div className="callout">{t('Your account is excluded from company signatures, so Outlook doesn’t add one. Ask IT if that’s a mistake.')}</div>
  ) : me.error ? (
    <ErrorNote error={me.error} retry={me.reload} />
  ) : !me.data ? (
    <Loading what={t('Loading your signature')} />
  ) : (
    <div className="split">
      <div className="stack loose">
        <DesignPicker me={me.data} onChanged={me.reload} />
        <GreetingEditor me={me.data} draft={greetingDraft} setDraft={setGreetingDraft} dirty={greetingDirty} onSaved={me.reload} />
        <section className="panel">
          <div className="panel-head">
            <h3>{t('Your details')}</h3>
          </div>
          <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <ReadOnlyRow label={t('Name')} value={me.data.fields.displayName as string} source={me.data.sources.displayName} />
            {(['jobTitleLv', 'jobTitleEn', 'mobilePhone', 'address'] as const).map((f) => {
              const label = f === 'jobTitleLv' ? ownTitleLabel(me.data!.fields.language as PersonLanguage | null) : t(FIELD_LABELS[f]);
              return editable.includes(f) ? (
                <div className="field-row" key={f}>
                  <label className="k" htmlFor={`me-${f}`}>
                    {label}
                  </label>
                  <div>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input
                        id={`me-${f}`}
                        type="text"
                        value={(draft[f] as string) ?? ''}
                        placeholder={entraFor(me.data!, f) ?? (f === 'jobTitleEn' ? t('e.g. {example}', { example: 'Sales Manager' }) : t('Not set'))}
                        onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                      />
                      {draft[f] ? (
                        <button type="button" className="btn ghost sm" title={f === 'address' ? t('Use the company address') : t('Use the company directory value')} onClick={() => setDraft((d) => ({ ...d, [f]: null }))}>
                          <Undo2 size={14} />
                        </button>
                      ) : null}
                    </div>
                    <div className="entra">{t(HINTS[f])}</div>
                  </div>
                </div>
              ) : (
                <ReadOnlyRow key={f} label={label} value={((me.data!.fields[f] as string) || (f === 'address' ? me.data!.defaultAddress : null)) ?? null} source={me.data!.sources[f]} />
              );
            })}
            <ReadOnlyRow label={t('Office phone')} value={me.data.fields.officePhone as string} source={me.data.sources.officePhone} />
            <ReadOnlyRow label={t('Email')} value={me.data.fields.email as string} source="entra" />
            <ReadOnlyRow label={t('Company')} value={me.data.companyName} source="entra" />
            {editable.includes('hideMobile') && (
              <div className="field-row">
                <span className="k">{t('Privacy')}</span>
                <label className="check" style={{ paddingTop: 8 }}>
                  <input type="checkbox" checked={draft.hideMobile === true} onChange={(e) => setDraft((d) => ({ ...d, hideMobile: e.target.checked ? true : null }))} />
                  {t('Leave my mobile number out')}
                </label>
              </div>
            )}
          </div>
          {editable.length > 0 && (
            <div className="panel-body row" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="spacer" />
              <button className="btn ghost" disabled={!dirty || saving} onClick={() => setDraft(me.data!.overrides ?? {})}>
                {t('Discard')}
              </button>
              <button className="btn primary" disabled={!dirty || saving} onClick={save}>
                {saving ? t('Saving…') : t('Save my signature')}
              </button>
            </div>
          )}
        </section>
        <p className="small muted">
          {editable.length === 0
            ? t('Your details come from the company directory. If your name, title, phone or company is wrong, ask IT to correct it there. That fixes it everywhere, not just in your signature.')
            : t('Everything else comes from the company directory. If your name, title, phone or company is wrong, ask IT to correct it there. That fixes it everywhere, not just in your signature.')}
        </p>
      </div>

      <div className="sticky stack">
        <LetterPreview
          html={preview.data ?? null}
          error={preview.error?.message}
          loading={preview.loading}
          type={type}
          onTypeChange={setType}
          from={{ name: (draft.displayName as string) || (me.data.fields.displayName as string) || me.data.upn, email: me.data.upn }}
        />
        <div className="row">
          <button className="btn" onClick={copy} disabled={dirty || !real.data} title={dirty ? t('Save first, then copy') : undefined}>
            {copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? t('Copied') : t('Copy signature')}
          </button>
          <span className="xs muted" style={{ flex: '1 1 220px' }}>
            {t("Outlook adds this automatically. Copy it only for apps where it doesn't appear.")}
          </span>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return (
      <>
        <header className="page-head">
          <div>
            <h1>{t('My signature')}</h1>
            <p>{t('How your own signature looks in Outlook.')}</p>
          </div>
        </header>
        {body}
      </>
    );
  }

  // Standalone page for people who aren't admins.
  return (
    <div className="self-page">
      <header className="self-bar">
        <Mark size={26} />
        <strong>{t('My email signature')}</strong>
        <span className="spacer" />
        <span className="small muted self-who">{session?.upn ?? session?.name}</span>
        {session?.isAdmin && (
          <Link className="btn ghost sm" to="/">
            {t('Admin console')}
          </Link>
        )}
        <button className="btn ghost sm" onClick={signOut}>
          <LogOut size={14} /> {t('Sign out')}
        </button>
      </header>
      <main className="main" style={{ margin: '0 auto' }}>
        <header className="page-head">
          <div>
            <h1>{firstName(session?.name) ? t('Hi, {name}', { name: firstName(session?.name) }) : t('Hi there')}</h1>
            <p>{me.data ? t('This is the signature Outlook adds to your emails as {company}.', { company: me.data.companyName }) : t('This is the signature Outlook adds to your emails.')}</p>
          </div>
        </header>
        {body}
      </main>
    </div>
  );
}

function ReadOnlyRow({ label, value, source }: { label: string; value: string | null | undefined; source?: string }) {
  return (
    <div className="field-row">
      <span className="k">{label}</span>
      <div style={{ paddingTop: 8 }}>
        {value ? value : <span className="muted">{t('Not set, so this line is left out')}</span>}
        {source === 'override' && <span className="tag action" style={{ marginLeft: 8 }}>{t('Corrected')}</span>}
      </div>
    </div>
  );
}

/** Fallback for browsers without async clipboard support: copy a rendered, selected copy of the HTML. */
function legacyCopy(html: string): boolean {
  const el = document.createElement('div');
  el.contentEditable = 'true';
  el.innerHTML = html;
  Object.assign(el.style, { position: 'fixed', left: '-9999px', top: '0', background: '#fff' });
  document.body.appendChild(el);
  const range = document.createRange();
  range.selectNodeContents(el);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  sel?.removeAllRanges();
  el.remove();
  return ok;
}

function entraFor(me: Me, f: string): string | null {
  if (f === 'jobTitleLv') return me.entra.jobTitle;
  if (f === 'mobilePhone') return me.entra.mobilePhone;
  if (f === 'address') return me.defaultAddress || null;
  return null;
}

function normalize(o: Record<string, unknown>, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = o[f];
    if (f === 'hideMobile') out[f] = v === true ? true : null;
    else out[f] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  return out;
}

function firstName(name?: string) {
  return (name ?? '').split(/\s+/)[0];
}

/** Choose which of the company's signatures is your default (if there's more than one and IT hasn't locked it). */
function DesignPicker({ me, onChanged }: { me: Me; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const designs = me.designs ?? [];
  if (me.designLocked) {
    return (
      <div className="callout">
        {tx('Your signature design is {name}, set by your administrator.', { name: <strong>{me.design?.name}</strong> })}
      </div>
    );
  }
  if (designs.length < 2) return null;
  const pick = async (id: string) => {
    setBusy(true);
    try {
      await api.put('/api/me/design', { design: id });
      toast(t('{name} is now your default signature', { name: designs.find((d) => d.id === id)?.name ?? '' }));
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="stack tight">
      <h3>{t('Your signature')}</h3>
      <p className="small muted">{t('Outlook adds this one automatically. You can switch for a single email with the Signatures button in Outlook.')}</p>
      <div className="design-cards" role="radiogroup" aria-label={t('Your signature design')}>
        {designs.map((d) => (
          <button key={d.id} type="button" role="radio" aria-checked={d.selected} className="design-card" disabled={busy} onClick={() => !d.selected && pick(d.id)}>
            <strong>{d.name}</strong>
            <span>{d.selected ? t('Your default') : t('Use as default')}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The person's own closing line above the signature: company default, their own words, or none. */
function GreetingEditor({
  me,
  draft,
  setDraft,
  dirty,
  onSaved,
}: {
  me: Me;
  draft: string | null | undefined;
  setDraft: (v: string | null | undefined) => void;
  dirty: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const value = draft !== undefined ? draft : me.greeting ?? null;
  const mode: 'default' | 'own' | 'none' = value === null ? 'default' : value === '' ? 'none' : 'own';
  const def = me.defaultGreeting ?? '';

  async function save() {
    setSaving(true);
    try {
      await api.put('/api/me/greeting', { greeting: value });
      toast(value === null ? t('Using the company closing line') : value === '' ? t('No closing line from now on') : t('Closing line saved'));
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{t('Closing line')}</h3>
        <span className="spacer" />
        <span className="xs muted">{t('Shown above your signature')}</span>
      </div>
      <div className="panel-body stack tight">
        <Segmented<'default' | 'own' | 'none'>
          label={t('Closing line')}
          value={mode}
          onChange={(m) => setDraft(m === 'default' ? null : m === 'none' ? '' : value && value !== '' ? value : def || 'Ar cieņu,')}
          options={[
            { value: 'default', label: t('Company default') },
            { value: 'own', label: t('My own') },
            { value: 'none', label: t('None') },
          ]}
        />
        {mode === 'own' && (
          <input type="text" maxLength={120} value={value ?? ''} placeholder={t('e.g. {example}', { example: 'Ar cieņu, / Best regards,' })} onChange={(e) => setDraft(e.target.value)} aria-label={t('Your closing line')} />
        )}
        <p className="xs muted">
          {mode === 'default' ? (def ? t('Your company uses “{line}”.', { line: def }) : t('Your company doesn’t add a closing line.')) : mode === 'none' ? t('Nothing is added above your signature.') : t('Used in every new email and reply.')}
        </p>
        {dirty && (
          <div className="row end">
            <button className="btn ghost sm" onClick={() => setDraft(undefined)}>
              {t('Discard')}
            </button>
            <button className="btn primary sm" disabled={saving || (mode === 'own' && !value?.trim())} onClick={save}>
              {saving ? t('Saving…') : t('Save closing line')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
