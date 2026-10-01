import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ClipboardCopy, LogOut, Undo2 } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useDebounced, useToast } from '../lib/hooks';
import { FIELD_LABELS, type ComposeType } from '../lib/types';
import { LetterPreview } from '../components/LetterPreview';
import { Mark, signOut } from '../components/Layout';
import { ErrorNote, Loading } from '../components/ui';

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
  selfService: { enabled: boolean; fields: string[] };
}

const HINTS: Record<string, string> = {
  jobTitleEn: 'Shown under your Latvian title',
  jobTitleLv: 'Replaces the title from the company directory',
  mobilePhone: 'Replaces the number from the company directory',
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
  const debounced = useDebounced(clean, 300);
  const preview = useAsync(
    () =>
      !me.data
        ? Promise.resolve('')
        : dirty
          ? api.post<string>('/api/me/preview-draft', { type, overrides: debounced })
          : api.get<string>(`/api/me/preview?type=${type}`),
    [type, JSON.stringify(debounced), !!me.data, dirty],
  );

  async function save() {
    setSaving(true);
    try {
      await api.put('/api/me/overrides', clean);
      toast('Saved. Your next new message in Outlook uses it.');
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
    const fail = (e: unknown) => toast(`Couldn't copy: ${(e as Error)?.message ?? 'the browser blocked it'}. Select the preview and copy it instead.`, 'error');
    const toText = (h: string) => new DOMParser().parseFromString(h, 'text/html').body.innerText;

    // Called synchronously in the click: a ClipboardItem may hold promises, so this also works if the prefetch
    // hasn't finished yet (Safari and Chrome both support that).
    const html: Promise<string> = real.data ? Promise.resolve(real.data) : api.get<string>(`/api/signature?type=${type}`);
    try {
      const item = new ClipboardItem({
        'text/html': html.then((h) => new Blob([h], { type: 'text/html' })),
        'text/plain': html.then((h) => new Blob([toText(h)], { type: 'text/plain' })),
      });
      navigator.clipboard.write([item]).then(done, () => (real.data && legacyCopy(real.data) ? done() : fail(new Error('the browser blocked clipboard access'))));
    } catch (e) {
      if (real.data && legacyCopy(real.data)) done();
      else fail(e);
    }
  }

  const body = me.data?.excluded ? (
    <div className="callout">Your account is excluded from company signatures, so Outlook doesn’t add one. Ask IT if that’s a mistake.</div>
  ) : me.error ? (
    <ErrorNote error={me.error} retry={me.reload} />
  ) : !me.data ? (
    <Loading what="Loading your signature" />
  ) : (
    <div className="split">
      <div className="stack loose">
        <section className="panel">
          <div className="panel-head">
            <h3>Your details</h3>
          </div>
          <div className="panel-body" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <ReadOnlyRow label="Name" value={me.data.fields.displayName as string} source={me.data.sources.displayName} />
            {(['jobTitleLv', 'jobTitleEn', 'mobilePhone'] as const).map((f) =>
              editable.includes(f) ? (
                <div className="field-row" key={f}>
                  <label className="k" htmlFor={`me-${f}`}>
                    {FIELD_LABELS[f]}
                  </label>
                  <div>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <input
                        id={`me-${f}`}
                        type="text"
                        value={(draft[f] as string) ?? ''}
                        placeholder={entraFor(me.data!, f) ?? (f === 'jobTitleEn' ? 'e.g. Sales Manager' : 'Not set')}
                        onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                      />
                      {draft[f] ? (
                        <button type="button" className="btn ghost sm" title="Use the company directory value" onClick={() => setDraft((d) => ({ ...d, [f]: null }))}>
                          <Undo2 size={14} />
                        </button>
                      ) : null}
                    </div>
                    <div className="entra">{HINTS[f]}</div>
                  </div>
                </div>
              ) : (
                <ReadOnlyRow key={f} label={FIELD_LABELS[f]} value={me.data!.fields[f] as string} source={me.data!.sources[f]} />
              ),
            )}
            <ReadOnlyRow label="Office phone" value={me.data.fields.officePhone as string} source={me.data.sources.officePhone} />
            <ReadOnlyRow label="Email" value={me.data.fields.email as string} source="entra" />
            <ReadOnlyRow label="Company" value={me.data.companyName} source="entra" />
            {editable.includes('hideMobile') && (
              <div className="field-row">
                <span className="k">Privacy</span>
                <label className="check" style={{ paddingTop: 8 }}>
                  <input type="checkbox" checked={draft.hideMobile === true} onChange={(e) => setDraft((d) => ({ ...d, hideMobile: e.target.checked ? true : null }))} />
                  Leave my mobile number out
                </label>
              </div>
            )}
          </div>
          {editable.length > 0 && (
            <div className="panel-body row" style={{ borderTop: '1px solid var(--line)' }}>
              <span className="spacer" />
              <button className="btn ghost" disabled={!dirty || saving} onClick={() => setDraft(me.data!.overrides ?? {})}>
                Discard
              </button>
              <button className="btn primary" disabled={!dirty || saving} onClick={save}>
                {saving ? 'Saving…' : 'Save my signature'}
              </button>
            </div>
          )}
        </section>
        <p className="small muted">
          {editable.length === 0
            ? 'Your details come from the company directory. '
            : 'Everything else comes from the company directory. '}
          If your name, title, phone or company is wrong, ask IT to correct it there. That fixes it everywhere, not just
          in your signature.
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
          <button className="btn" onClick={copy} disabled={dirty || !real.data} title={dirty ? 'Save first, then copy' : undefined}>
            {copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? 'Copied' : 'Copy signature'}
          </button>
          <span className="xs muted" style={{ flex: '1 1 220px' }}>
            Outlook adds this automatically. Copy it only for apps where it doesn't appear.
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
            <h1>My signature</h1>
            <p>How your own signature looks in Outlook.</p>
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
        <strong>My email signature</strong>
        <span className="spacer" />
        <span className="small muted self-who">{session?.upn ?? session?.name}</span>
        {session?.isAdmin && (
          <Link className="btn ghost sm" to="/">
            Admin console
          </Link>
        )}
        <button className="btn ghost sm" onClick={signOut}>
          <LogOut size={14} /> Sign out
        </button>
      </header>
      <main className="main" style={{ margin: '0 auto' }}>
        <header className="page-head">
          <div>
            <h1>Hi, {firstName(session?.name)}</h1>
            <p>This is the signature Outlook adds to your emails{me.data ? ` as ${me.data.companyName}` : ''}.</p>
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
        {value ? value : <span className="muted">Not set, so this line is left out</span>}
        {source === 'override' && <span className="tag action" style={{ marginLeft: 8 }}>Corrected</span>}
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
  return (name ?? '').split(/\s+/)[0] || 'there';
}
