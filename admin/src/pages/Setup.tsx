import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Terminal } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { useApp, useAsync, useToast } from '../lib/hooks';
import type { Company, ComposeType, Settings, UserSummary } from '../lib/types';
import { Mark } from '../components/Layout';
import { CodeBlock, Field, Loading } from '../components/ui';
import { DirectoryForm, type ScriptOutput } from '../components/DirectoryForm';
import { CompanyGroupsEditor } from '../components/CompanyGroupsEditor';
import { AddinSteps } from '../components/AddinSteps';
import { LetterPreview } from '../components/LetterPreview';
import { passwordProblem } from '../lib/password';

const STEPS = [
  'Unlock setup',
  'Create your admin account',
  'Server address',
  'Connect Entra ID',
  'Companies and groups',
  'Signature options',
  'Check a signature',
  'Roll out the Outlook add-in',
];

export function Setup() {
  const { config, session } = useApp();
  const firstRun = config.needsFirstAdmin;
  const [code, setCode] = useState('');
  const [step, setStep] = useState(firstRun ? 0 : 2);
  const settings = useAsync(() => (session ? api.get<Settings>('/api/admin/settings') : Promise.resolve(undefined)), [session]);
  const [script, setScript] = useState<ScriptOutput | undefined>();

  // Resume where the admin left off.
  useEffect(() => {
    if (!firstRun && settings.data) setStep(Math.min(Math.max(settings.data.setupStep, 2), STEPS.length - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstRun, !!settings.data]);

  const go = async (n: number) => {
    setStep(n);
    window.scrollTo({ top: 0 });
    if (session && n >= 2) await api.put('/api/admin/settings', { setupStep: n }).catch(() => {});
  };

  let body: ReactNode;
  if (step === 0) body = <UnlockStep code={code} setCode={setCode} next={() => go(1)} />;
  else if (step === 1) body = <AdminStep code={code} back={() => go(0)} />;
  else if (!settings.data) body = <Loading />;
  else {
    const s = settings.data;
    const reload = () => settings.reload();
    body = [
      null,
      null,
      <AddressStep key="a" settings={s} next={async () => { await reload(); await go(3); }} />,
      <StepFrame key="d" title="Connect Entra ID" lead="The service reads names, titles and phone numbers from Entra ID. It never writes to it. You can start with demo data and connect the tenant later in Settings.">
        <DirectoryForm settings={s} onSaved={async (_n, out) => { setScript(out); await reload(); await go(4); }} />
        <Nav back={() => go(2)} skip={() => go(4)} skipLabel="Skip for now" />
      </StepFrame>,
      <StepFrame key="c" title="Companies and groups" lead="Each person gets their company's signature based on the security group they're in. Rename companies, point them at the right groups, and set the order that settles overlaps.">
        {script?.groups && <div className="callout ok">Group IDs from the setup script are filled in. Check them, then save.</div>}
        <CompaniesLoader>{(companies) => <CompanyGroupsEditor companies={companies} settings={s} prefill={script?.groups} saveLabel="Save and continue" onSaved={async () => { await reload(); await go(5); }} />}</CompaniesLoader>
        <Nav back={() => go(3)} />
      </StepFrame>,
      <OptionsStep key="o" settings={s} back={() => go(4)} next={async () => { await reload(); await go(6); }} />,
      <PreviewStep key="p" back={() => go(5)} next={() => go(7)} />,
      <FinishStep key="f" settings={s} back={() => go(6)} />,
    ][step];
  }

  return (
    <div className="setup">
      <aside className="setup-rail">
        <div className="brand">
          <Mark />
          <div>
            Signatures
            <small>First-time setup</small>
          </div>
        </div>
        <ol className="steps">
          {STEPS.map((label, i) => {
            const state = i < step ? 'done' : i === step ? 'current' : '';
            const reachable = !firstRun && i >= 2 && i <= Math.max(step, settings.data?.setupStep ?? 0);
            const inner = (
              <>
                <span className="dot">{i < step ? <Check size={14} /> : i + 1}</span>
                <span className="label" style={{ paddingTop: 4 }}>{label}</span>
              </>
            );
            return (
              <li key={label} className={state} aria-current={i === step ? 'step' : undefined}>
                {reachable && i !== step ? (
                  <button type="button" onClick={() => go(i)} style={{ display: 'contents' }}>
                    {inner}
                  </button>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ol>
        <p className="xs muted" style={{ marginTop: 'auto' }}>
          Everything here can be changed later in Settings. Your progress is saved as you go.
        </p>
      </aside>
      <main className="setup-main">{body}</main>
    </div>
  );
}

function CompaniesLoader({ children }: { children: (c: Company[]) => ReactNode }) {
  const r = useAsync(() => api.get<Company[]>('/api/admin/companies'));
  return r.data ? <>{children(r.data)}</> : <Loading />;
}

function StepFrame({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className="stack loose">
      <div>
        <h1>{title}</h1>
        <p className="lead">{lead}</p>
      </div>
      {children}
    </div>
  );
}

function Nav({ back, next, nextLabel = 'Continue', skip, skipLabel, busy }: { back?: () => void; next?: () => void; nextLabel?: string; skip?: () => void; skipLabel?: string; busy?: boolean }) {
  return (
    <div className="setup-foot">
      {back ? (
        <button type="button" className="btn ghost" onClick={back}>
          Back
        </button>
      ) : (
        <span />
      )}
      <div className="row">
        {skip && (
          <button type="button" className="btn ghost" onClick={skip}>
            {skipLabel}
          </button>
        )}
        {next && (
          <button type="button" className="btn primary" onClick={next} disabled={busy}>
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ───────── Step 1 ─────────
function UnlockStep({ code, setCode, next }: { code: string; setCode: (c: string) => void; next: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/setup/verify', { token: code });
      next();
    } catch (err) {
      setError((err as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <StepFrame title="Welcome" lead="This console sets up company email signatures for everyone at Tenax Grupa. First, prove you have access to the server: it printed a one-time setup code when it started.">
      <ol className="instructions">
        <li>
          <div className="stack tight" style={{ width: '100%' }}>
            <span>On the Docker host, show the container log:</span>
            <CodeBlock>docker compose logs signature | grep "Setup code"</CodeBlock>
          </div>
        </li>
        <li>
          <span>
            Copy the code from the box that says <em>First launch</em>. It works once, and only until the first admin account
            exists.
          </span>
        </li>
      </ol>
      <form onSubmit={submit} className="stack" style={{ maxWidth: 380 }}>
        <Field label="Setup code" error={error}>
          <input type="text" className="setup-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoFocus autoComplete="one-time-code" spellCheck={false} aria-invalid={!!error} />
        </Field>
        <button className="btn primary lg" disabled={busy || code.trim().length < 4}>
          <Terminal size={16} /> {busy ? 'Checking…' : 'Unlock setup'}
        </button>
      </form>
    </StepFrame>
  );
}

// ───────── Step 2 ─────────
function AdminStep({ code, back }: { code: string; back: () => void }) {
  const { refresh } = useApp();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = password ? passwordProblem(password) : null;
  const mismatch = confirm && confirm !== password ? "The passwords don't match" : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (problem || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/setup/admin', { token: code, username, password });
      await refresh(); // now signed in; wizard continues at step 3
    } catch (err) {
      setError((err as ApiError).message);
      setBusy(false);
    }
  }
  return (
    <StepFrame title="Create your admin account" lead="This local account always works, even if Microsoft sign-in is misconfigured. Keep it as a break-glass login and store the password in your password manager.">
      <form onSubmit={submit} className="stack" style={{ maxWidth: 420 }}>
        <Field label="Username">
          <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required minLength={3} />
        </Field>
        <Field label="Password" hint="At least 12 characters, mixing letters with numbers or symbols" error={problem}>
          <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required aria-invalid={!!problem} />
        </Field>
        <Field label="Repeat password" error={mismatch}>
          <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required aria-invalid={!!mismatch} />
        </Field>
        {error && <div className="callout danger" role="alert">{error}</div>}
        <button className="btn primary lg" disabled={busy || !!problem || !!mismatch || !password || !confirm}>
          {busy ? 'Creating…' : 'Create account and continue'}
        </button>
      </form>
      <Nav back={back} />
    </StepFrame>
  );
}

// ───────── Step 3 ─────────
function AddressStep({ settings, next }: { settings: Settings; next: () => Promise<void> }) {
  const toast = useToast();
  const [url, setUrl] = useState(settings.publicUrl);
  const [busy, setBusy] = useState(false);
  const here = window.location.origin;
  const invalid = !/^https:\/\/[^/]+$/.test(url.replace(/\/+$/, '')) ? 'Use https:// and a host name only, e.g. https://sig.tenax.lv' : null;

  async function save() {
    setBusy(true);
    try {
      await api.put('/api/admin/settings', { publicUrl: url.replace(/\/+$/, '') });
      await next();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <StepFrame title="Server address" lead="Outlook downloads the add-in and logo images from this address, so it must be reachable over HTTPS by everyone who sends email.">
      <div className="stack" style={{ maxWidth: 520 }}>
        <Field label="Public address" error={invalid}>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!!invalid} />
        </Field>
        {here !== url.replace(/\/+$/, '') && (
          <div className="callout">
            You're using this console at <code>{here}</code>. That's fine for setup. Point DNS for the public address at this
            server and terminate TLS in front of it (reverse proxy or load balancer) before the pilot.
          </div>
        )}
      </div>
      <Nav next={save} busy={busy || !!invalid} nextLabel="Save and continue" />
    </StepFrame>
  );
}

// ───────── Step 6 ─────────
const SELF_FIELDS: { key: string; label: string }[] = [
  { key: 'jobTitleEn', label: 'English job title' },
  { key: 'hideMobile', label: 'Hide mobile number' },
  { key: 'mobilePhone', label: 'Mobile number' },
  { key: 'jobTitleLv', label: 'Latvian job title' },
  { key: 'address', label: 'Address line (e.g. another office)' },
];

export function SignatureOptions({ settings, onSaved, saveLabel = 'Save options' }: { settings: Settings; onSaved: () => void; saveLabel?: string }) {
  const toast = useToast();
  const [language, setLanguage] = useState(settings.language);
  const [enabled, setEnabled] = useState(settings.selfServiceEnabled);
  const [fields, setFields] = useState<string[]>(settings.selfServiceFields);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api.put('/api/admin/settings', { language, selfServiceEnabled: enabled, selfServiceFields: fields });
      toast('Signature options saved');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack loose">
      <section className="stack">
        <h3>Job title language</h3>
        {(
          [
            ['bilingual', 'Latvian and English', 'Both titles, English on its own line when set'],
            ['lv', 'Latvian only', 'English titles are ignored'],
            ['en', 'English only', 'Falls back to the Latvian title when no English one is set'],
          ] as const
        ).map(([v, label, hint]) => (
          <label key={v} className="check">
            <input type="radio" name="lang" checked={language === v} onChange={() => setLanguage(v)} />
            <span>
              <strong>{label}</strong>
              <br />
              <span className="muted xs">{hint}</span>
            </span>
          </label>
        ))}
      </section>
      <section className="stack">
        <h3>Self-service</h3>
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>
            <strong>Let people edit parts of their own signature</strong>
            <br />
            <span className="muted xs">People sign in with Microsoft at this address and edit the fields you tick on their My signature page. Everyone can always view their own signature.</span>
          </span>
        </label>
        {enabled && (
          <div className="stack tight" style={{ paddingLeft: 26 }}>
            {SELF_FIELDS.map((f) => (
              <label key={f.key} className="check">
                <input type="checkbox" checked={fields.includes(f.key)} onChange={(e) => setFields(e.target.checked ? [...fields, f.key] : fields.filter((x) => x !== f.key))} />
                {f.label}
              </label>
            ))}
          </div>
        )}
      </section>
      <div className="row">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

function OptionsStep({ settings, back, next }: { settings: Settings; back: () => void; next: () => void }) {
  return (
    <StepFrame title="Signature options" lead="Choose the job title language and whether people can adjust their own signature.">
      <SignatureOptions settings={settings} onSaved={next} saveLabel="Save and continue" />
      <Nav back={back} />
    </StepFrame>
  );
}

// ───────── Step 7 ─────────
function PreviewStep({ back, next }: { back: () => void; next: () => void }) {
  const users = useAsync(() => api.get<UserSummary[]>('/api/admin/users'));
  const [upn, setUpn] = useState('');
  const [type, setType] = useState<ComposeType>('newMail');
  const selected = upn || users.data?.[0]?.upn || '';
  const preview = useAsync(() => (selected ? api.get<string>(`/api/admin/users/${encodeURIComponent(selected)}/preview?type=${type}`) : Promise.resolve('')), [selected, type]);
  const person = users.data?.find((u) => u.upn === selected);

  return (
    <StepFrame title="Check a signature" lead="Pick a few people and look at their signature. You can change the designs in the Designs page after setup.">
      {users.error ? (
        <div className="callout danger">
          Couldn't load people: {users.error.message}. Go back and test the directory connection.
        </div>
      ) : !users.data ? (
        <Loading what="Loading people" />
      ) : users.data.length === 0 ? (
        <div className="callout warn">The directory returned no licensed users. Check the Graph permissions from the Entra step.</div>
      ) : (
        <div className="stack">
          <Field label="Person">
            <select value={selected} onChange={(e) => setUpn(e.target.value)}>
              {users.data.map((u) => (
                <option key={u.upn} value={u.upn}>
                  {u.displayName ?? u.upn} · {u.companyName}
                  {u.missing.length ? ` (missing ${u.missing.length})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <LetterPreview html={preview.data ?? null} error={preview.error?.message} loading={preview.loading} type={type} onTypeChange={setType} from={person ? { name: person.displayName ?? person.upn, email: person.upn } : undefined} />
        </div>
      )}
      <Nav back={back} next={next} />
    </StepFrame>
  );
}

// ───────── Step 8 ─────────
function FinishStep({ settings, back }: { settings: Settings; back: () => void }) {
  const { refresh } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function finish() {
    setBusy(true);
    try {
      await api.post('/api/admin/setup/complete');
      await refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }
  return (
    <StepFrame title="Roll out the Outlook add-in" lead="The add-in inserts the signature automatically in new Outlook, classic Outlook, Outlook on the web, Mac and mobile. Start with the pilot group.">
      {settings.directoryMode === 'mock' && (
        <div className="callout warn">
          You're still on demo data. The add-in needs the Entra connection to identify real people, so connect it in
          Settings before uploading the manifest.
        </div>
      )}
      <AddinSteps settings={settings} />
      <Nav back={back} next={finish} busy={busy} nextLabel="Finish setup" />
    </StepFrame>
  );
}
