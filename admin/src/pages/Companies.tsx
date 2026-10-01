import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '../lib/api';
import { useAsync, useToast } from '../lib/hooks';
import type { Company, Settings } from '../lib/types';
import { CompanyGroupsEditor } from '../components/CompanyGroupsEditor';
import { ErrorNote, Field, Loading, Modal, PageHead } from '../components/ui';

export function Companies() {
  const companies = useAsync(() => api.get<Company[]>('/api/admin/companies'));
  const settings = useAsync(() => api.get<Settings>('/api/admin/settings'));
  const [adding, setAdding] = useState(false);

  const error = companies.error ?? settings.error;
  return (
    <>
      <PageHead
        title="Companies and groups"
        lead="Company names used in signatures, and the Entra security group that puts each person in a company."
        actions={
          <button className="btn" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add company
          </button>
        }
      />
      {error && <ErrorNote error={error} />}
      {!companies.data || !settings.data ? (
        !error && <Loading />
      ) : (
        <CompanyGroupsEditor
          companies={companies.data}
          settings={settings.data}
          onSaved={() => {
            void companies.reload();
            void settings.reload();
          }}
        />
      )}
      {companies.data && <AddCompany open={adding} onClose={() => setAdding(false)} companies={companies.data} onAdded={companies.reload} />}
    </>
  );
}

function AddCompany({ open, onClose, companies, onAdded }: { open: boolean; onClose: () => void; companies: Company[]; onAdded: () => void }) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [key, setKey] = useState('');
  const [copyFrom, setCopyFrom] = useState(companies[0]?.key ?? '');
  const autoKey = displayName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 32);
  const finalKey = key || autoKey;

  async function add() {
    try {
      await api.post('/api/admin/companies', {
        key: finalKey,
        displayName,
        legalName: legalName || `SIA "${displayName}"`,
        groupName: `SG-Signature-${displayName.replace(/\s+/g, '')}`,
        groupId: '',
        priority: companies.length + 1,
        copyFrom,
      });
      toast(`${displayName} added. Set its group, then adjust its design.`);
      setDisplayName('');
      setLegalName('');
      setKey('');
      onAdded();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a company">
      <Field label="Short name">
        <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
      </Field>
      <Field label="Legal name" hint={`Defaults to SIA "${displayName || '…'}"`}>
        <input type="text" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
      </Field>
      <Field label="Key" hint="Lowercase ID used in folders and URLs. It can't be changed later.">
        <input type="text" className="mono" value={finalKey} onChange={(e) => setKey(e.target.value)} />
      </Field>
      <Field label="Start from the design of">
        <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
          {companies.map((c) => (
            <option key={c.key} value={c.key}>
              {c.displayName}
            </option>
          ))}
        </select>
      </Field>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!displayName || !/^[a-z][a-z0-9-]{1,31}$/.test(finalKey)} onClick={add}>
          Add company
        </button>
      </div>
    </Modal>
  );
}
