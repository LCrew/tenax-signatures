import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useCompanies, useToast } from '../lib/hooks';
import type { Design, SharedMailbox } from '../lib/types';
import { CompanyName, ErrorNote, Field, Loading, Modal, PageHead } from '../components/ui';

const EMPTY: SharedMailbox = { email: '', company: '', displayName: '', officePhone: '' };

export function Mailboxes() {
  const toast = useToast();
  const list = useAsync(() => api.get<SharedMailbox[]>('/api/admin/shared-mailboxes'));
  const { companies } = useCompanies();
  const [editing, setEditing] = useState<SharedMailbox | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [removing, setRemoving] = useState<SharedMailbox | null>(null);

  async function save() {
    if (!editing) return;
    try {
      await api.put(`/api/admin/shared-mailboxes/${encodeURIComponent(editing.email)}`, editing);
      toast(isNew ? 'Shared mailbox added' : 'Shared mailbox saved');
      setEditing(null);
      await list.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <>
      <PageHead
        title="Shared mailboxes"
        lead="When someone switches the From address to one of these mailboxes, Outlook swaps in the mailbox's own signature."
        actions={
          <button
            className="btn primary"
            onClick={() => {
              setIsNew(true);
              setEditing({ ...EMPTY, company: companies[0]?.key ?? '' });
            }}
          >
            <Plus size={14} /> Add mailbox
          </button>
        }
      />
      {list.error && <ErrorNote error={list.error} retry={list.reload} />}
      {!list.data ? (
        !list.error && <Loading />
      ) : list.data.length === 0 ? (
        <div className="panel empty">No shared mailboxes yet. Senders using a shared mailbox get their personal signature.</div>
      ) : (
        <div className="panel table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Mailbox</th>
                <th>Name in signature</th>
                <th>Company design</th>
                <th>Phone</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((m) => {
                const c = companies.find((x) => x.key === m.company);
                return (
                  <tr key={m.email} className="clickable" onClick={() => { setIsNew(false); setEditing({ ...m, officePhone: m.officePhone ?? '' }); }}>
                    <td className="name">{m.email}</td>
                    <td>{m.displayName}</td>
                    <td>
                      <CompanyName name={c?.displayName ?? m.company} color={c?.color} />
                    </td>
                    <td>{m.officePhone ?? <span className="muted">none</span>}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); setRemoving(m); }} aria-label={`Remove ${m.email}`}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={isNew ? 'Add shared mailbox' : 'Edit shared mailbox'}>
        {editing && (
          <>
            <Field label="Mailbox address">
              <input type="email" value={editing.email} disabled={!isNew} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </Field>
            <Field label="Name in signature" hint="e.g. Tenax klientu serviss">
              <input type="text" value={editing.displayName} onChange={(e) => setEditing({ ...editing, displayName: e.target.value })} />
            </Field>
            <Field label="Company design">
              <select value={editing.company} onChange={(e) => setEditing({ ...editing, company: e.target.value })}>
                {companies.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </Field>
            <MailboxDesign company={editing.company} value={editing.design ?? ''} onChange={(v) => setEditing({ ...editing, design: v || null })} />
            <Field label="Phone" hint="Optional">
              <input type="text" value={editing.officePhone ?? ''} onChange={(e) => setEditing({ ...editing, officePhone: e.target.value })} />
            </Field>
            <div className="row end">
              <button className="btn ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={!editing.email || !editing.displayName}>
                {isNew ? 'Add mailbox' : 'Save mailbox'}
              </button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={!!removing} onClose={() => setRemoving(null)} title="Remove shared mailbox?">
        <p>People sending as {removing?.email} will get their personal signature instead.</p>
        <div className="row end">
          <button className="btn ghost" onClick={() => setRemoving(null)}>
            Keep it
          </button>
          <button
            className="btn danger"
            onClick={async () => {
              await api.del(`/api/admin/shared-mailboxes/${encodeURIComponent(removing!.email)}`);
              toast('Shared mailbox removed');
              setRemoving(null);
              await list.reload();
            }}
          >
            Remove mailbox
          </button>
        </div>
      </Modal>
    </>
  );
}

function MailboxDesign({ company, value, onChange }: { company: string; value: string; onChange: (v: string) => void }) {
  const designs = useAsync(() => (company ? api.get<Design[]>(`/api/admin/designs?company=${encodeURIComponent(company)}`) : Promise.resolve([] as Design[])), [company]);
  const service = designs.data?.find((d) => d.purpose === 'service');
  return (
    <Field label="Design" hint={service ? `Default: ${service.name} (the company's service design)` : 'Default: the company default design'}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{service ? `${service.name} (service design)` : 'Company default'}</option>
        {(designs.data ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
