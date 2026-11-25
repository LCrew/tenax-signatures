import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Building2, ChevronRight, Ellipsis, Gauge, Inbox, Languages, LogOut, Palette, PenLine, Settings, UserRound, Users } from 'lucide-react';
import { api, setMockUser } from '../lib/api';
import { entraAccount, signOutMicrosoft } from '../lib/auth';
import { useApp, useCompanies } from '../lib/hooks';
import { withViewTransition } from '../lib/appearance';
import { t } from '../lib/i18n';
import { AppearanceSheet } from './Appearance';
import { LangSwitch } from './LangSwitch';
import { Modal } from './ui';

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

function initials(name: string | undefined | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·';
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Item = { to: string; label: string; icon: ReactNode; end?: boolean };

/**
 * The console shell.
 * Desktop: a floating glass sidebar (nav, account, appearance, sign out) next to the page.
 * Phones (≤800px): a tab bar at the bottom (Overview, People, Designs, More), a compact title bar that appears
 * once the large page title has scrolled away, and a "More" sheet for the rest.
 */
export function Layout() {
  const { session, config } = useApp();
  const { companies } = useCompanies();
  const nameOf = (key: string) => companies.find((c) => c.key === key)?.displayName ?? key;
  const loc = useLocation();
  const navigate = useNavigate();
  const [more, setMore] = useState(false);
  const [appearance, setAppearance] = useState(false);
  useEffect(() => setMore(false), [loc.pathname]);

  const main: Item[] = [
    { to: '/', label: t('Overview'), icon: <Gauge size={18} />, end: true },
    { to: '/people', label: t('People'), icon: <Users size={18} /> },
    { to: '/designs', label: t('Designs'), icon: <PenLine size={18} /> },
  ];
  const mine: Item[] = session?.kind !== 'local' ? [{ to: '/my-signature', label: t('My signature'), icon: <UserRound size={18} /> }] : [];
  const setup: Item[] = session?.isAdmin
    ? [
        { to: '/companies', label: t('Companies & groups'), icon: <Building2 size={18} /> },
        { to: '/mailboxes', label: t('Shared mailboxes'), icon: <Inbox size={18} /> },
        { to: '/settings', label: t('Settings'), icon: <Settings size={18} /> },
        { to: '/activity', label: t('Activity'), icon: <Activity size={18} /> },
      ]
    : [];

  // Desktop: switching pages cross-fades with a View Transition. The router applies the new location in a
  // React transition, so the update callback waits for the commit (or 400ms at most).
  const committed = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    committed.current?.();
    committed.current = null;
  }, [loc.key]);
  const go = (e: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (loc.pathname === to) {
      // Tapping the current tab goes back to the top.
      window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    withViewTransition(
      () =>
        new Promise<void>((resolve) => {
          committed.current = resolve;
          setTimeout(resolve, 400);
          navigate(to);
        }),
      'tab',
    );
  };

  const tab = loc.pathname === '/' ? 0 : loc.pathname.startsWith('/people') ? 1 : loc.pathname.startsWith('/designs') ? 2 : 3;
  const section = loc.pathname.split('/')[1] || 'overview';

  const mainRef = useRef<HTMLElement>(null);
  const { title, compact } = useCompactTitle(mainRef, loc.pathname);

  const tags = (
    <>
      {config.directoryMode === 'mock' && <span className="tag warn">{t('Demo directory')}</span>}
      {!session?.isAdmin && (session?.editorOf?.length ?? 0) > 0 && (
        <span className="tag action" title={t("You can edit these companies' designs and their people's signature details")}>
          {t('Editor: {companies}', { companies: session!.editorOf!.map(nameOf).join(', ') })}
        </span>
      )}
    </>
  );
  const account = (
    <div className="account">
      <span className="avatar" aria-hidden>
        {initials(session?.name)}
      </span>
      <div className="account__text">
        <strong>{session?.name}</strong>
        <span className="xs muted">{session?.kind === 'local' ? t('Local account') : session?.upn}</span>
      </div>
    </div>
  );

  return (
    <div className="shell">
      <aside className="sidebar" aria-label={t('Main navigation')}>
        <div className="brand">
          <Mark size={32} />
          <div>
            {t('Signatures')}
            <small>Tenax Grupa</small>
          </div>
        </div>
        <nav className="nav">
          {[...main, ...mine].map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end} onClick={(e) => go(e, i.to)}>
              {i.icon} {i.label}
            </NavLink>
          ))}
          {setup.length > 0 && (
            <>
              <div className="nav-group-label">{t('Setup')}</div>
              {setup.map((i) => (
                <NavLink key={i.to} to={i.to} onClick={(e) => go(e, i.to)}>
                  {i.icon} {i.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="tags">{tags}</div>
          {account}
          <div className="row" style={{ gap: 4, flexWrap: 'nowrap', justifyContent: 'space-between' }}>
            <button className="btn ghost sm" onClick={() => setAppearance(true)}>
              <Palette size={15} /> {t('Appearance')}
            </button>
            <LangSwitch />
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn ghost sm" onClick={signOut}>
              <LogOut size={15} /> {t('Sign out')}
            </button>
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className={`cbar${compact ? ' on' : ''}`} aria-hidden="true">
          <span className="cbar__title">{title}</span>
        </header>
        <main className="main" ref={mainRef} key={section}>
          <Outlet />
        </main>
      </div>

      <nav className="bnav" aria-label={t('Main navigation')}>
        <span className="bnav__pill" style={{ transform: `translateX(${tab * 100}%)` }} aria-hidden />
        {main.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} onClick={(e) => go(e, i.to)}>
            {i.icon}
            <span>{i.label}</span>
          </NavLink>
        ))}
        <button type="button" className={tab === 3 ? 'active' : undefined} aria-haspopup="dialog" onClick={() => setMore(true)}>
          <Ellipsis size={18} />
          <span>{t('More')}</span>
        </button>
      </nav>

      <Modal open={more} onClose={() => setMore(false)} title={t('More')} variant="sheet" size="auto">
        {mine.length > 0 && (
          <div className="options">
            {mine.map((i) => (
              <NavLink key={i.to} to={i.to} className="option">
                {i.icon}
                <span className="option__text">{i.label}</span>
                <ChevronRight className="option__chev" size={18} aria-hidden />
              </NavLink>
            ))}
          </div>
        )}
        {setup.length > 0 && (
          <section className="stack tight">
            <h3 className="section-label">{t('Setup')}</h3>
            <div className="options">
              {setup.map((i) => (
                <NavLink key={i.to} to={i.to} className="option">
                  {i.icon}
                  <span className="option__text">{i.label}</span>
                  <ChevronRight className="option__chev" size={18} aria-hidden />
                </NavLink>
              ))}
            </div>
          </section>
        )}
        <section className="stack tight">
          {account}
          <div className="tags">{tags}</div>
          <div className="options">
            <button
              type="button"
              className="option"
              onClick={() => {
                setMore(false);
                setAppearance(true);
              }}
            >
              <Palette size={18} />
              <span className="option__text">{t('Appearance')}</span>
              <ChevronRight className="option__chev" size={18} aria-hidden />
            </button>
            <div className="option">
              <Languages size={18} />
              <span className="option__text">{t('Language')}</span>
              <LangSwitch />
            </div>
            <button type="button" className="option danger" onClick={signOut}>
              <LogOut size={18} />
              <span className="option__text">{t('Sign out')}</span>
            </button>
          </div>
        </section>
      </Modal>
      <AppearanceSheet open={appearance} onClose={() => setAppearance(false)} />
    </div>
  );
}

/** Phones: the page's large title, and whether it has scrolled out of view (then the compact bar shows it). */
function useCompactTitle(mainRef: RefObject<HTMLElement | null>, path: string) {
  const [title, setTitle] = useState('');
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const root = mainRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    let current: Element | null = null;
    let io: IntersectionObserver | null = null;
    const attach = () => {
      const h1 = root.querySelector('h1');
      if (h1 === current) {
        if (h1) setTitle(h1.textContent ?? '');
        return;
      }
      io?.disconnect();
      current = h1;
      setTitle(h1?.textContent ?? '');
      setCompact(false);
      if (!h1) return;
      io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 0));
      io.observe(h1);
    };
    attach();
    // Pages draw their title after loading; follow it.
    const mo = new MutationObserver(attach);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      mo.disconnect();
      io?.disconnect();
    };
  }, [mainRef, path]);
  return { title, compact };
}
