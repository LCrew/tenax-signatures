import { Link, useNavigate } from 'react-router-dom';
import { Download, RefreshCw } from 'lucide-react';
import { api, download } from '../lib/api';
import { useAsync, useCompanies, useToast } from '../lib/hooks';
import { FIELD_LABELS, type Report, type TelemetryEvent } from '../lib/types';
import { CompanyName, ErrorNote, Loading, PageHead, timeAgo } from '../components/ui';

export function Overview() {
  const toast = useToast();
  const nav = useNavigate();
  const report = useAsync(() => api.get<Report>('/api/admin/report'));
  const telemetry = useAsync(() => api.get<TelemetryEvent[]>('/api/admin/telemetry'));
  const { companies } = useCompanies();
  const colorOf = (k: string) => companies.find((c) => c.key === k)?.color;

  const r = report.data;
  const issues = r?.rows.filter((u) => u.conflict || u.companySource === 'default' || u.missing.length > 0) ?? [];
  const recentErrors = (telemetry.data ?? []).filter((t) => Date.now() - new Date(t.at).getTime() < 24 * 3600_000);

  return (
    <>
      <PageHead
        title="Overview"
        lead="How complete everyone's signature data is. Fix gaps in on-premises AD where you can; corrections here are a stopgap."
        actions={
          <>
            <button
              className="btn"
              onClick={async () => {
                await api.post('/api/admin/cache/clear');
                await report.reload();
                toast('Reloaded from the directory');
              }}
            >
              <RefreshCw size={14} /> Refresh from directory
            </button>
            <button className="btn primary" onClick={() => download('/api/admin/report.csv', 'signature-report.csv').catch((e) => toast(e.message, 'error'))}>
              <Download size={14} /> Download CSV
            </button>
          </>
        }
      />
      {report.error && <ErrorNote error={report.error} retry={report.reload} />}
      {!r ? (
        !report.error && <Loading what="Building report" />
      ) : (
        <div className="stack loose">
          <div className="stats">
            <div className="stat">
              <div className="n">{r.total}</div>
              <div className="l">people with a mailbox licence</div>
            </div>
            <div className="stat">
              <div className="n">{r.total ? Math.round((r.complete / r.total) * 100) : 0}%</div>
              <div className="l">have every signature field</div>
            </div>
            <div className="stat">
              <div className="n" style={{ color: r.conflicts ? 'var(--warn)' : undefined }}>{r.conflicts}</div>
              <div className="l">in more than one company group</div>
            </div>
            <div className="stat">
              <div className="n" style={{ color: r.defaulted ? 'var(--warn)' : undefined }}>{r.defaulted}</div>
              <div className="l">in no company group</div>
            </div>
          </div>

          <div className="two-col">
            <section className="panel">
              <div className="panel-head">
                <h3>Missing fields</h3>
              </div>
              <div className="panel-body stack tight">
                {Object.keys(r.missingByField).length === 0 ? (
                  <p className="muted">Nothing missing. Every signature is complete.</p>
                ) : (
                  Object.entries(r.missingByField)
                    .sort((a, b) => b[1] - a[1])
                    .map(([f, n]) => (
                      <div className="bar-row" key={f}>
                        <span>{FIELD_LABELS[f] ?? f}</span>
                        <div className="bar" aria-hidden>
                          <span style={{ width: `${(n / r.total) * 100}%` }} />
                        </div>
                        <span className="muted" style={{ textAlign: 'right' }}>{n}</span>
                      </div>
                    ))
                )}
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h3>People per company</h3>
              </div>
              <div className="panel-body stack tight">
                {companies.map((c) => (
                  <div className="bar-row" key={c.key}>
                    <CompanyName name={c.displayName} color={c.color} />
                    <div className="bar" aria-hidden>
                      <span style={{ width: `${((r.byCompany[c.key] ?? 0) / Math.max(r.total, 1)) * 100}%`, background: c.color }} />
                    </div>
                    <span className="muted" style={{ textAlign: 'right' }}>{r.byCompany[c.key] ?? 0}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section>
            <div className="section-title">
              <h2>Needs attention</h2>
              <p>{issues.length} {issues.length === 1 ? 'person' : 'people'}</p>
            </div>
            <div className="panel table-wrap">
              {issues.length === 0 ? (
                <div className="empty">No conflicts, no one without a company, no missing fields.</div>
              ) : (
                <table className="data">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Company</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((u) => (
                      <tr key={u.upn} className="clickable" onClick={() => nav(`/people/${encodeURIComponent(u.upn)}`)}>
                        <td>
                          <Link to={`/people/${encodeURIComponent(u.upn)}`} className="name" style={{ color: 'inherit', textDecoration: 'none' }} onClick={(e) => e.stopPropagation()}>
                            {u.displayName ?? u.upn}
                          </Link>
                          <div className="sub">{u.upn}</div>
                        </td>
                        <td>
                          <CompanyName name={u.companyName} color={colorOf(u.company)} />
                        </td>
                        <td>
                          <div className="tags">
                            {u.conflict && <span className="tag warn">In {u.candidates.length} company groups</span>}
                            {u.companySource === 'default' && <span className="tag warn">No company group</span>}
                            {u.missing.map((m) => (
                              <span key={m} className="tag">No {FIELD_LABELS[m]?.toLowerCase() ?? m}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section>
            <div className="section-title">
              <h2>Outlook add-in errors</h2>
              <p>Last 24 hours</p>
            </div>
            <div className="panel">
              {recentErrors.length === 0 ? (
                <div className="empty">No failures reported by Outlook clients.</div>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <tbody>
                      {recentErrors.slice(0, 10).map((t) => (
                        <tr key={t.id}>
                          <td className="sub" style={{ whiteSpace: 'nowrap' }}>{timeAgo(t.at)}</td>
                          <td>{t.upn ?? 'unknown user'}</td>
                          <td>
                            <span className="tag danger">{t.stage ?? t.event}</span>
                          </td>
                          <td className="sub">{t.message}</td>
                          <td className="sub">{[t.host, t.platform].filter(Boolean).join(' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
