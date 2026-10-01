import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../lib/hooks';
import type { Company, Settings } from '../lib/types';
import { Field } from './ui';
import { GroupPicker } from './GroupPicker';

type Draft = Company & { dirty?: boolean };

/**
 * Edit company names and which Entra security group puts someone in each company. Shared by the
 * setup wizard and the Companies page. Group IDs from the setup script can be passed in to prefill.
 */
export function CompanyGroupsEditor({
  companies,
  settings,
  prefill,
  onSaved,
  saveLabel = 'Save companies and groups',
}: {
  companies: Company[];
  settings: Settings;
  prefill?: Record<string, string>;
  onSaved: () => void;
  saveLabel?: string;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Draft[]>(companies);
  const [defaultCompany, setDefaultCompany] = useState(settings.defaultCompany);
  const [admins, setAdmins] = useState({ name: settings.adminGroupName, id: settings.adminGroupId });
  const [pilot, setPilot] = useState({ name: settings.pilotGroupName, id: settings.pilotGroupId });
  const [busy, setBusy] = useState(false);

  useEffect(() => setRows(companies), [companies]);

  // Script output: { "SG-Signature-Tenax": "<guid>", … } → match by group name.
  useEffect(() => {
    if (!prefill) return;
    const valid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);
    setRows((rs) => rs.map((r) => (valid(prefill[r.groupName]) ? { ...r, groupId: prefill[r.groupName], dirty: true } : r)));
    if (valid(prefill[admins.name])) setAdmins((a) => ({ ...a, id: prefill[a.name] }));
    if (valid(prefill[pilot.name])) setPilot((p) => ({ ...p, id: prefill[p.name] }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const update = (key: string, patch: Partial<Company>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, dirty: true } : r)));

  const move = (i: number, dir: -1 | 1) => {
    const next = [...rows];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next.map((r, idx) => ({ ...r, priority: idx + 1, dirty: true })));
  };

  async function save() {
    setBusy(true);
    try {
      for (const r of rows.filter((r) => r.dirty)) {
        const { key, dirty: _d, ...body } = r;
        await api.put(`/api/admin/companies/${key}`, body);
      }
      await api.put('/api/admin/settings', {
        defaultCompany,
        adminGroupName: admins.name,
        adminGroupId: admins.id,
        pilotGroupName: pilot.name,
        pilotGroupId: pilot.id,
      });
      toast('Companies and groups saved');
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
        {rows.map((c, i) => (
          <div key={c.key} className="panel">
            <div className="panel-head">
              <strong>{c.displayName || c.key}</strong>
              <span className="tag">Priority {i + 1}</span>
              <span className="spacer" />
              <button type="button" className="btn ghost sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${c.displayName} up`}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className="btn ghost sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move ${c.displayName} down`}>
                <ArrowDown size={14} />
              </button>
            </div>
            <div className="panel-body stack">
              <div className="grid-2">
                <Field label="Short name" hint="Shown in signatures and in this console">
                  <input type="text" value={c.displayName} onChange={(e) => update(c.key, { displayName: e.target.value })} />
                </Field>
                <Field label="Legal name" hint='Used in the footer, e.g. SIA "Tenax"'>
                  <input type="text" value={c.legalName} onChange={(e) => update(c.key, { legalName: e.target.value })} />
                </Field>
              </div>
              <GroupPicker label="Security" name={c.groupName} id={c.groupId} onChange={(g) => update(c.key, { groupName: g.name, groupId: g.id })} />
            </div>
          </div>
        ))}
        <p className="xs muted">
          When someone is in more than one company group, the company higher in this list wins, and they're flagged on the
          Overview page so you can fix their membership.
        </p>
      </section>

      <section className="stack">
        <h3>People in no company group</h3>
        <Field label="Use this company's signature" hint="They're also listed on the Overview page so you can add them to the right group.">
          <select value={defaultCompany} onChange={(e) => setDefaultCompany(e.target.value)}>
            {rows.map((c) => (
              <option key={c.key} value={c.key}>
                {c.displayName}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="stack">
        <h3>Access groups</h3>
        <GroupPicker label="Admins" name={admins.name} id={admins.id} onChange={(g) => setAdmins(g)} />
        <p className="xs muted">Members can sign in to this console with their Microsoft account.</p>
        <GroupPicker label="Pilot" name={pilot.name} id={pilot.id} onChange={(g) => setPilot(g)} />
        <p className="xs muted">Assign the Outlook add-in to this group first. Everyone else keeps their current signature until you roll out.</p>
      </section>

      <div className="row">
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}
