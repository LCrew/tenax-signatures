import { useState, type FormEvent } from 'react';
import { ApiError, api, setMockUser } from '../lib/api';
import { signInWithMicrosoft } from '../lib/auth';
import { useApp } from '../lib/hooks';
import { Mark } from '../components/Layout';
import { Field } from '../components/ui';

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/** Illustrative sheet for the sign-in side panel. */
export function SampleSheet() {
  return (
    <div className="sheet" aria-hidden>
      <div className="sheet-head">
        <div>
          <b>From</b>&nbsp; Līga Paraudziņa &lt;liga.paraudzina@tenaxgrupa.lv&gt;
        </div>
        <div>
          <b>Subject</b>&nbsp; Piedāvājums: siltumizolācijas paneļi
        </div>
      </div>
      <div className="sheet-body">
        <div className="prose-line" style={{ width: '90%' }} />
        <div className="prose-line" style={{ width: '74%' }} />
        <div className="prose-line" style={{ width: '82%' }} />
        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', fontFamily: 'Calibri, Arial, sans-serif', color: '#002060', paddingBottom: 18 }}>
          <div style={{ width: 92, height: 46, background: 'linear-gradient(#e2231a 0 55%, #002060 55%)', marginRight: 10 }} />
          <div style={{ borderLeft: '1px solid #002060', paddingLeft: 10, fontSize: 12.5, lineHeight: '16px' }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Līga Paraudziņa</div>
            <div style={{ fontSize: 13.5 }}>Pārdošanas projektu vadītāja</div>
            <div style={{ height: 6 }} />
            <div>M: +371 29 123 456</div>
            <div>liga.paraudzina@tenaxgrupa.lv</div>
            <div>SIA “TENAPORS”</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { config, refresh } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mockUpn, setMockUpn] = useState('test.tenax@tenaxgrupa.lv');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { username, password });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  const localForm = (
    <form className="stack" onSubmit={submit}>
      <Field label="Username">
        <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus={!config.entra} />
      </Field>
      <Field label="Password">
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {error && <div className="callout danger" role="alert">{error}</div>}
      <button className={`btn lg ${config.entra ? '' : 'primary'}`} disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in as administrator'}
      </button>
    </form>
  );

  return (
    <div className="auth-page">
      <section className="auth-side">
        <div className="brand">
          <Mark />
          <div>
            Signatures
            <small>Tenax Grupa</small>
          </div>
        </div>
        <SampleSheet />
        <p className="small muted" style={{ maxWidth: '46ch' }}>
          One signature per company, filled in from the company directory. Outlook adds it automatically on every device.
        </p>
      </section>
      <section className="auth-form">
        <div className="inner">
          <div>
            <h1>Email signature</h1>
            <p className="muted" style={{ marginTop: 6 }}>
              Sign in with your work account to see and adjust your signature.
            </p>
          </div>

          {config.entra ? (
            <>
              <button className="btn primary lg" onClick={() => signInWithMicrosoft().catch((e) => setError(e.message))}>
                <MicrosoftLogo /> Sign in with Microsoft
              </button>
              {error && !username && <div className="callout danger" role="alert">{error}</div>}
              <details className="admin-login">
                <summary>Administrator sign-in with a local account</summary>
                <div style={{ paddingTop: 16 }}>{localForm}</div>
              </details>
            </>
          ) : (
            <>
              <div className="callout warn">
                Microsoft sign-in isn't connected yet, so employees can't sign in. An administrator can connect it in
                Settings › Entra ID connection.
              </div>
              {localForm}
            </>
          )}

          {config.mockAuth && (
            <details className="panel">
              <summary className="panel-body" style={{ cursor: 'pointer', fontWeight: 600 }}>
                Development: sign in as a fixture user
              </summary>
              <div className="panel-body stack" style={{ paddingTop: 0 }}>
                <Field label="Fixture UPN" hint="test.tenax@tenaxgrupa.lv is an admin; the others see only their own signature">
                  <input type="text" value={mockUpn} onChange={(e) => setMockUpn(e.target.value)} />
                </Field>
                <button
                  className="btn"
                  onClick={async () => {
                    setMockUser(mockUpn);
                    await refresh();
                  }}
                >
                  Continue as fixture user
                </button>
              </div>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}
