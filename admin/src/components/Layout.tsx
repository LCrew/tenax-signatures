import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Activity, Building2, Gauge, Inbox, LogOut, Menu, PenLine, Settings, UserRound, Users } from 'lucide-react';
import { api, setMockUser } from '../lib/api';
import { entraAccount, signOutMicrosoft } from '../lib/auth';
import { useApp, useCompanies } from '../lib/hooks';

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--action)" />
      <path d="M7 21c3-1 4-9 7-9s1 7 4 7 3-4 7-5" fill="none" stroke="var(--action-ink)" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export async function signOut() {
  await api.post('/api/auth/logout').catch(() => {});
  setMockUser(null);
  if (entraAccount()) await signOutMicrosoft();
  else window.location.assign('/login');
}

export function Layout() {
  const { session, config } = useApp();
  const { companies } = useCompanies();
  const nameOf = (key: string) => companies.find((c) => c.key === key)?.displayName ?? key;
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <Mark />
          <div>
            Signatures
            <small>Tenax Grupa</small>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            <Gauge size={17} /> Overview
          </NavLink>
          <NavLink to="/people">
            <Users size={17} /> People
          </NavLink>
          <NavLink to="/designs">
            <PenLine size={17} /> Designs
          </NavLink>
          {session?.kind !== 'local' && (
            <NavLink to="/my-signature">
              <UserRound size={17} /> My signature
            </NavLink>
          )}
          {session?.isAdmin && (
            <>
          <div className="nav-group-label">Setup</div>
          <NavLink to="/companies">
            <Building2 size={17} /> Companies & groups
          </NavLink>
          <NavLink to="/mailboxes">
            <Inbox size={17} /> Shared mailboxes
          </NavLink>
          <NavLink to="/settings">
            <Settings size={17} /> Settings
          </NavLink>
          <NavLink to="/activity">
            <Activity size={17} /> Activity
          </NavLink>
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          {config.directoryMode === 'mock' && <span className="tag warn">Demo directory</span>}
          {!session?.isAdmin && (session?.editorOf?.length ?? 0) > 0 && (
            <span className="tag action" title="You can edit these companies' designs and their people's signature details">
              Editor: {session!.editorOf!.map(nameOf).join(', ')}
            </span>
          )}
          <div>
            <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{session?.name}</div>
            <div className="xs">{session?.kind === 'local' ? 'Local account' : session?.upn}</div>
          </div>
          <button className="btn ghost sm" style={{ justifyContent: 'flex-start', padding: 0 }} onClick={signOut}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>
      <div>
        <div className="mobile-bar">
          <button className="btn ghost sm" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
          <Mark size={22} /> <strong>Signatures</strong>
        </div>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
