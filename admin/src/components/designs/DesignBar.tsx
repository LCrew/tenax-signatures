import { useEffect, useState } from 'react';
import { Plus, Settings2, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { useAsync, useToast } from '../../lib/hooks';
import type { Design, MetaOverrides } from '../../lib/types';
import { Field, Modal } from '../ui';

/** Chips for a company's designs (Standard ★, English, Service…) plus "New design" and per-design settings. */
export function DesignBar({
  company,
  companyName,
  designs,
  activeId,
  onSelect,
  onChanged,
}: {
  company: string;
  companyName: string;
  designs: Design[];
  activeId: string;
  onSelect: (id: string) => void;
  onChanged: (selectId?: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Design | null>(null);
  const active = designs.find((d) => d.id === activeId);

  return (
    <div className="design-bar">
      <div className="design-chips" role="tablist" aria-label={`${companyName} designs`}>
        {designs.map((d) => (
          <button key={d.id} role="tab" aria-selected={d.id === activeId} className="design-chip" onClick={() => onSelect(d.id)}>
            {d.isDefault && <Star size={12} aria-label="default" />}
            {d.name}
            {d.purpose === 'service' && !/service/i.test(d.name) && <span className="tag">Service</span>}
            {d.purpose === 'person' && !d.selectable && !d.isDefault && <span className="tag" title="Only admins can assign it">Assigned only</span>}
          </button>
        ))}
        <button className="btn ghost sm" onClick={() => setCreating(true)}>
          <Plus size={14} /> New design
        </button>
      </div>
      {active && (
        <button className="btn ghost sm" onClick={() => setEditing(active)} title="Name, default, who can choose it, remove">
          <Settings2 size={14} /> Design settings
        </button>
      )}
      <NewDesignModal open={creating} onClose={() => setCreating(false)} company={company} designs={designs} activeId={activeId} onCreated={(id) => onChanged(id)} />
      <DesignSettingsModal design={editing} onClose={() => setEditing(null)} onChanged={() => onChanged()} />
    </div>
  );
}

function NewDesignModal({
  open,
  onClose,
  company,
  designs,
  activeId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  company: string;
  designs: Design[];
  activeId: string;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<'person' | 'service'>('person');
  const [selectable, setSelectable] = useState(true);
  const [copyFrom, setCopyFrom] = useState(activeId);
  useEffect(() => setCopyFrom(activeId), [activeId, open]);

  async function create() {
    try {
      const d = await api.post<Design>('/api/admin/designs', { company, name, purpose, selectable, copyFrom });
      toast(`${d.name} created as a copy. Change its layout and wording, then save.`);
      setName('');
      onCreated(d.id);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="New design">
      <Field label="Name" hint='e.g. "English" for English-speaking clients, or "Service"'>
        <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600 }}>For</span>
        <label className="check">
          <input type="radio" name="purpose" checked={purpose === 'person'} onChange={() => setPurpose('person')} />
          <span>
            <strong>People</strong>
            <br />
            <span className="xs muted">A design employees use, for example an English version.</span>
          </span>
        </label>
        <label className="check">
          <input type="radio" name="purpose" checked={purpose === 'service'} onChange={() => setPurpose('service')} />
          <span>
            <strong>Service accounts</strong>
            <br />
            <span className="xs muted">For shared and service mailboxes (info@, serviss@). Only admins assign it; people can’t choose it.</span>
          </span>
        </label>
      </div>
      {purpose === 'person' && (
        <label className="check">
          <input type="checkbox" checked={selectable} onChange={(e) => setSelectable(e.target.checked)} />
          <span>People can choose it themselves (My signature and the Signatures button in Outlook)</span>
        </label>
      )}
      <Field label="Start as a copy of">
        <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
          {designs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="row end">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!name.trim()} onClick={create}>
          Create design
        </button>
      </div>
    </Modal>
  );
}

function DesignSettingsModal({ design, onClose, onChanged }: { design: Design | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [selectable, setSelectable] = useState(true);
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (design) {
      setName(design.name);
      setSelectable(design.selectable);
      setConfirm('');
    }
  }, [design]);
  if (!design) return null;

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg);
      onChanged();
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <Modal open={!!design} onClose={onClose} title={`${design.name} settings`}>
      <Field label="Name">
        <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </Field>
      {design.purpose === 'person' ? (
        <label className="check">
          <input type="checkbox" checked={selectable} onChange={(e) => setSelectable(e.target.checked)} />
          <span>People can choose it themselves</span>
        </label>
      ) : (
        <p className="xs muted">Service design: only admins assign it, to service accounts and shared mailboxes.</p>
      )}
      <div className="row end">
        <button className="btn primary" onClick={() => run(() => api.put(`/api/admin/designs/${design.id}`, { name, selectable }), 'Design settings saved')}>
          Save settings
        </button>
      </div>
      {!design.isDefault && design.purpose === 'person' && (
        <div className="callout row">
          <span style={{ flex: '1 1 220px' }}>Make {design.name} the company default: everyone without a choice or assignment gets it.</span>
          <button className="btn sm" onClick={() => run(() => api.put(`/api/admin/designs/${design.id}`, { isDefault: true }), `${design.name} is now the default`)}>
            <Star size={13} /> Make default
          </button>
        </div>
      )}
      {!design.isDefault && (
        <div className="stack tight">
          <h3>Remove design</h3>
          <p className="xs muted">People and mailboxes using it switch to their next option (usually the default). Its versions stay in the history.</p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input type="text" placeholder={`Type ${design.name} to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn danger" disabled={confirm.trim() !== design.name} onClick={() => run(() => api.del(`/api/admin/designs/${design.id}`), `${design.name} removed`)}>
              Remove
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Per-design wording on top of the company's Brand and footer (e.g. English closing line and notice). */
export function WordingForm({
  company,
  companyMeta,
  value,
  onChange,
}: {
  company: string;
  companyMeta: any;
  value: MetaOverrides;
  onChange: (v: MetaOverrides) => void;
}) {
  const assets = useAsync(() => api.get<{ name: string; localUrl: string }[]>(`/api/admin/assets/${company}`), [company]);
  const banners = (assets.data ?? []).filter((a) => a.name.startsWith('banner-'));
  const footer = value.footer ?? {};
  const setFooter = (k: 'companyLine' | 'confidential', v: string | undefined) => {
    const f = { ...footer, [k]: v };
    if (v === undefined) delete f[k];
    const { footer: _old, ...rest } = value;
    onChange(Object.keys(f).length === 0 ? rest : { ...rest, footer: f });
  };
  const setTop = (k: 'greeting' | 'banner', v: any) => {
    const next: any = { ...value, [k]: v };
    if (v === undefined) delete next[k];
    onChange(next);
  };

  const row = (label: string, own: boolean, toggle: (own: boolean) => void, input: React.ReactNode, companyValue: string) => (
    <div className="wording-row">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong className="small">{label}</strong>
        <div className="segmented" role="group" aria-label={label}>
          <button type="button" aria-pressed={!own} onClick={() => toggle(false)}>
            Company setting
          </button>
          <button type="button" aria-pressed={own} onClick={() => toggle(true)}>
            This design
          </button>
        </div>
      </div>
      {own ? input : <p className="xs muted">{companyValue || 'Empty, so it’s left out'}</p>}
    </div>
  );

  return (
    <div className="stack">
      <p className="small muted">
        Logo, colours, websites and address come from <strong>Brand and footer</strong> for every design. Here you can
        give this design its own wording, for example in English.
      </p>
      {row(
        'Closing line',
        value.greeting !== undefined,
        (own) => setTop('greeting', own ? companyMeta?.greeting ?? '' : undefined),
        <input type="text" value={value.greeting ?? ''} maxLength={200} placeholder="e.g. Best regards," onChange={(e) => setTop('greeting', e.target.value)} />,
        companyMeta?.greeting ?? '',
      )}
      {row(
        'Company line',
        footer.companyLine !== undefined,
        (own) => setFooter('companyLine', own ? companyMeta?.footer?.companyLine ?? '' : undefined),
        <input type="text" value={footer.companyLine ?? ''} maxLength={200} onChange={(e) => setFooter('companyLine', e.target.value)} />,
        companyMeta?.footer?.companyLine ?? '',
      )}
      {row(
        'Confidentiality notice',
        footer.confidential !== undefined,
        (own) => setFooter('confidential', own ? companyMeta?.footer?.confidential ?? '' : undefined),
        <textarea rows={3} style={{ fontFamily: 'var(--font)', fontSize: 'var(--t-sm)' }} value={footer.confidential ?? ''} maxLength={3000} onChange={(e) => setFooter('confidential', e.target.value)} />,
        companyMeta?.footer?.confidential ?? '',
      )}
      {row(
        'Promo banner',
        value.banner !== undefined,
        (own) => setTop('banner', own ? companyMeta?.banner ?? null : undefined),
        <div className="stack tight">
          <select
            value={value.banner?.file ?? ''}
            onChange={(e) => {
              const file = e.target.value;
              if (!file) return setTop('banner', null);
              const img = new Image();
              img.onload = () => {
                const w = Math.min(600, img.naturalWidth);
                setTop('banner', { ...(value.banner ?? {}), file, width: w, height: Math.round((img.naturalHeight * w) / img.naturalWidth) });
              };
              img.src = banners.find((b) => b.name === file)?.localUrl ?? '';
            }}
          >
            <option value="">No banner</option>
            {banners.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name.replace(/^banner-/, '')}
              </option>
            ))}
          </select>
          {value.banner && (
            <input type="url" placeholder="Link when clicked (https://…)" value={value.banner.link ?? ''} onChange={(e) => setTop('banner', { ...value.banner!, link: e.target.value })} />
          )}
          <span className="xs muted">Upload banners in Brand and footer.</span>
        </div>,
        companyMeta?.banner?.file ? companyMeta.banner.file.replace(/^banner-/, '') : '',
      )}
    </div>
  );
}
