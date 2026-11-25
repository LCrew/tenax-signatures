import { useEffect, useState } from 'react';
import { Plus, Settings2, Star } from 'lucide-react';
import { api } from '../../lib/api';
import { useToast } from '../../lib/hooks';
import type { Design, MetaOverrides } from '../../lib/types';
import { Field, Modal, Segmented } from '../ui';
import { type Asset, BannerPicker } from './BannerPicker';

/** Chips for a company's designs (Standard ★, English, Service…) plus "New design" and per-design settings. */
export function DesignBar({
  company,
  companyName,
  designs,
  activeId,
  onSelect,
  onChanged,
  onUseImage,
}: {
  company: string;
  companyName: string;
  designs: Design[];
  activeId: string;
  onSelect: (id: string) => void;
  onChanged: (selectId?: string) => void;
  onUseImage: (id: string) => void;
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
            {d.format === 'image' && <span className="tag">Image</span>}
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
      <DesignSettingsModal design={editing} onClose={() => setEditing(null)} onChanged={() => onChanged()} onUseImage={onUseImage} />
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

function DesignSettingsModal({ design, onClose, onChanged, onUseImage }: { design: Design | null; onClose: () => void; onChanged: () => void; onUseImage: (id: string) => void }) {
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
      <div className="callout row">
        {design.format === 'image' ? (
          <>
            <span style={{ flex: '1 1 220px' }}>This design is one image rendered from an SVG template.</span>
            <button className="btn sm" onClick={() => run(() => api.put(`/api/admin/designs/${design.id}`, { format: 'html' }), 'Back to the designer layouts')}>
              Use designer layouts
            </button>
          </>
        ) : (
          <>
            <span style={{ flex: '1 1 220px' }}>Use a single image made from an SVG file instead (e.g. a designer’s signature card).</span>
            <button
              className="btn sm"
              onClick={() => {
                onUseImage(design.id);
                onClose();
              }}
            >
              Use an SVG image
            </button>
          </>
        )}
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
export type TitleLanguage = 'lv' | 'en' | 'bilingual';
export const TITLE_LABELS: Record<TitleLanguage, string> = {
  bilingual: 'Latvian and English',
  lv: 'Latvian only',
  en: 'English only',
};

type BannerChoice = 'language' | 'none' | 'fixed';

/**
 * Design › Wording and job titles: which job titles this design shows, and wording that differs from the company's
 * (closing line, company line, notice). Banners come from Languages and banners; a design can only switch them off
 * (or, for older designs, pin one banner for everybody).
 */
export function WordingForm({
  company,
  companyName,
  companyMeta,
  value,
  onChange,
  language,
  globalLanguage,
  onLanguageChange,
  assets,
  onUploaded,
}: {
  company: string;
  companyName: string;
  companyMeta: any;
  value: MetaOverrides;
  onChange: (v: MetaOverrides) => void;
  /** This design's job titles; null = Settings. */
  language: TitleLanguage | null;
  globalLanguage?: TitleLanguage;
  onLanguageChange: (l: TitleLanguage | null) => void;
  assets: Asset[];
  onUploaded: () => void;
}) {
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
  const bannerChoice: BannerChoice = value.banner === undefined ? 'language' : value.banner === null ? 'none' : 'fixed';

  const row = (label: string, own: boolean, toggle: (own: boolean) => void, input: React.ReactNode, companyValue: string, note?: string) => (
    <div className="wording-row">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong className="small">{label}</strong>
        <div className="segmented" role="group" aria-label={label}>
          <button type="button" aria-pressed={!own} onClick={() => toggle(false)}>
            Company’s
          </button>
          <button type="button" aria-pressed={own} onClick={() => toggle(true)}>
            This design’s own
          </button>
        </div>
      </div>
      {own ? input : <p className="xs muted">{companyValue ? `“${companyValue}”` : 'Empty, so it’s left out'}</p>}
      {own && note && <p className="xs muted">{note}</p>}
    </div>
  );

  return (
    <div className="stack loose">
      <section className="stack">
        <h3>Job titles</h3>
        <Field
          label="Shown in this design"
          hint="Estonian and Lithuanian colleagues always get their own-language title with the English one, except on English-only designs."
        >
          <select value={language ?? ''} onChange={(e) => onLanguageChange((e.target.value || null) as TitleLanguage | null)}>
            <option value="">Same as Settings{globalLanguage ? ` (${TITLE_LABELS[globalLanguage]})` : ''}</option>
            {(Object.keys(TITLE_LABELS) as TitleLanguage[]).map((l) => (
              <option key={l} value={l}>
                {TITLE_LABELS[l]}
                {l === 'en' ? ' (Latvian when there’s no English title)' : ''}
              </option>
            ))}
          </select>
        </Field>
        {(language ?? globalLanguage) === 'en' && (
          <p className="xs muted">English only: everyone on this design gets the English closing line and banner from {companyName} › Languages and banners.</p>
        )}
      </section>

      <section className="stack">
        <h3>Wording</h3>
        <p className="small muted">
          Logo, colours, websites and address come from <strong>Brand and footer</strong>, closing lines from{' '}
          <strong>Languages and banners</strong>. Give this design its own wording only where it must differ.
        </p>
        {row(
          'Closing line',
          value.greeting !== undefined,
          (own) => setTop('greeting', own ? companyMeta?.greeting ?? '' : undefined),
          <input type="text" value={value.greeting ?? ''} maxLength={200} placeholder="e.g. Best regards," onChange={(e) => setTop('greeting', e.target.value)} />,
          companyMeta?.greeting ?? '',
          'Replaces the Latvian closing line on this design. Estonian and Lithuanian colleagues keep theirs from Languages and banners. Left empty, nobody on this design gets one.',
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
      </section>

      <section className="stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3>Promo banner</h3>
          <Segmented<BannerChoice>
            label="Promo banner in this design"
            value={bannerChoice}
            options={[
              { value: 'language', label: 'Each person’s language banner' },
              { value: 'none', label: 'No banner' },
              ...(bannerChoice === 'fixed' ? [{ value: 'fixed' as const, label: 'One banner for everyone' }] : []),
            ]}
            onChange={(v) => setTop('banner', v === 'language' ? undefined : null)}
          />
        </div>
        {bannerChoice === 'language' && (
          <p className="small muted">
            People get the banner of their signature language, set in {companyName} › Languages and banners. New messages
            only.
          </p>
        )}
        {bannerChoice === 'none' && <p className="small muted">Nobody on this design gets a promo banner, whatever their language.</p>}
        {bannerChoice === 'fixed' && (
          <>
            <div className="callout warn">
              This design shows this banner instead of the Latvian one. Estonian and Lithuanian colleagues still get their
              own language’s banner where one is set. Switch to “Each person’s language banner” to manage banners only under
              Languages and banners.
            </div>
            <BannerPicker company={company} assets={assets} onUploaded={onUploaded} allowNone={false} value={value.banner ?? null} onChange={(b) => setTop('banner', b)} />
          </>
        )}
      </section>
    </div>
  );
}
