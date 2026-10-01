import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyStart,
  ArrowDown,
  ArrowUp,
  Bold,
  CaseUpper,
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  Italic,
  Minus,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  BLOCK_INFO,
  FONTS,
  TOKEN_LABELS,
  effectiveStyle,
  hasStyle,
  newBlock,
  type Block,
  type BlockColor,
  type BlockDoc,
  type BlockStyle,
  type BlockType,
  type ColorToken,
  type FontKey,
} from './model';
import { api } from '../../lib/api';
import { useAsync } from '../../lib/hooks';

type Zone = 'main' | 'footer';

interface Props {
  doc: BlockDoc;
  onChange: (doc: BlockDoc) => void;
  /** Brand colours from Brand and footer, to show token swatches. */
  colors: Record<string, string>;
  kind: 'new' | 'reply';
  /** Settings › Signature options › Job title language. */
  language?: 'lv' | 'en' | 'bilingual';
  /** For the banner picker: the company's uploaded banners, and the banner this design uses by default. */
  company?: string;
  defaultBanner?: string | null;
}

/** Visual signature designer: layout + text defaults + ordered blocks with per-block styles. */
export function BlockEditor({ doc, onChange, colors, kind, language, company, defaultBanner }: Props) {
  return (
    <LanguageCtx.Provider value={language}>
      <BannerCtx.Provider value={{ company, defaultBanner }}>
      <BlockEditorInner doc={doc} onChange={onChange} colors={colors} kind={kind} />
      </BannerCtx.Provider>
    </LanguageCtx.Provider>
  );
}

const LanguageCtx = createContext<Props['language']>(undefined);
const BannerCtx = createContext<Pick<Props, 'company' | 'defaultBanner'>>({});

function BlockEditorInner({ doc, onChange, colors, kind }: Omit<Props, 'language' | 'company' | 'defaultBanner'>) {
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<BlockDoc>) => onChange({ ...doc, ...patch });
  const families = useAsync(() => api.get<{ family: string; weights: number[] }[]>('/api/admin/fonts/families').catch(() => [])).data ?? [];
  const customFont = doc.base.font.startsWith('custom:') ? doc.base.font.slice(7) : null;

  return (
    <div className="stack loose">
      <section className="stack">
        <h3>Layout</h3>
        <div className="layout-cards" role="radiogroup" aria-label="Layout">
          <LayoutCard active={doc.layout === 'side'} onClick={() => set({ layout: 'side' })} label="Logo beside text" art="side" />
          <LayoutCard active={doc.layout === 'stacked'} onClick={() => set({ layout: 'stacked' })} label="Logo above text" art="stacked" />
          <LayoutCard active={doc.layout === 'textOnly'} onClick={() => set({ layout: 'textOnly' })} label="Text only" art="textOnly" />
        </div>
        <div className="ctl-grid">
          {doc.layout === 'side' && (
            <Ctl label="Align logo and text">
              <div className="segmented" role="group" aria-label="Vertical alignment">
                <button type="button" aria-pressed={doc.logo.valign === 'top'} onClick={() => set({ logo: { ...doc.logo, valign: 'top' } })} title="Top">
                  <AlignVerticalJustifyStart size={14} /> Top
                </button>
                <button type="button" aria-pressed={doc.logo.valign === 'middle'} onClick={() => set({ logo: { ...doc.logo, valign: 'middle' } })} title="Middle">
                  <AlignVerticalJustifyCenter size={14} /> Middle
                </button>
              </div>
            </Ctl>
          )}
          {doc.layout !== 'textOnly' || doc.divider.show ? (
            <Ctl label={doc.layout === 'textOnly' ? 'Space after bar' : 'Gap'}>
              <Stepper value={doc.logo.gap} min={0} max={40} unit="px" onChange={(v) => set({ logo: { ...doc.logo, gap: v ?? 12 } })} />
            </Ctl>
          ) : null}
          <Ctl label="Maximum width">
            <Stepper value={doc.maxWidth} min={280} max={600} step={10} unit="px" onChange={(v) => set({ maxWidth: v ?? 500 })} />
          </Ctl>
        </div>
        <div className="ctl-grid">
          <Ctl label={doc.layout === 'textOnly' ? 'Accent bar' : 'Divider line'}>
            <label className="switch">
              <input type="checkbox" checked={doc.divider.show} onChange={(e) => set({ divider: { ...doc.divider, show: e.target.checked } })} />
              <span>{doc.divider.show ? 'Shown' : 'Hidden'}</span>
            </label>
          </Ctl>
          {doc.divider.show && (
            <>
              <Ctl label="Thickness">
                <Stepper value={doc.divider.thickness} min={1} max={6} unit="px" onChange={(v) => set({ divider: { ...doc.divider, thickness: v ?? 1 } })} />
              </Ctl>
              <Ctl label="Colour" wide>
                <ColorField value={doc.divider.color} colors={colors} onChange={(c) => set({ divider: { ...doc.divider, color: c ?? 'primary' } })} />
              </Ctl>
            </>
          )}
        </div>
      </section>

      <section className="stack">
        <h3>Text</h3>
        <div className="ctl-grid">
          <Ctl label="Font">
            <select
              value={doc.base.font}
              onChange={(e) => {
                const font = e.target.value as BlockDoc['base']['font'];
                set({ base: { ...doc.base, font, fallback: font.startsWith('custom:') ? (doc.base.fallback ?? 'arial') : undefined } });
              }}
            >
              <optgroup label="Email-safe (everyone sees these)">
                {(Object.keys(FONTS) as FontKey[]).map((k) => (
                  <option key={k} value={k}>
                    {FONTS[k]}
                  </option>
                ))}
              </optgroup>
              {families.length > 0 && (
                <optgroup label="Uploaded fonts (only where installed)">
                  {families.map((f) => (
                    <option key={f.family} value={`custom:${f.family}`}>
                      {f.family}
                    </option>
                  ))}
                </optgroup>
              )}
              {customFont && !families.some((f) => f.family === customFont) && <option value={doc.base.font}>{customFont} (not uploaded)</option>}
            </select>
          </Ctl>
          {customFont && (
            <Ctl label="If they don’t have it">
              <select value={doc.base.fallback ?? 'arial'} onChange={(e) => set({ base: { ...doc.base, fallback: e.target.value as FontKey } })}>
                {(Object.keys(FONTS) as FontKey[]).map((k) => (
                  <option key={k} value={k}>
                    {FONTS[k]}
                  </option>
                ))}
              </select>
            </Ctl>
          )}
          <Ctl label="Base size">
            <Stepper value={doc.base.size} min={6} max={24} step={0.5} unit="pt" onChange={(v) => set({ base: { ...doc.base, size: v ?? 10 } })} />
          </Ctl>
          <Ctl label={`Line spacing ${doc.base.lineHeight.toFixed(2)}×`}>
            <input
              type="range"
              min={1}
              max={2}
              step={0.05}
              value={doc.base.lineHeight}
              onChange={(e) => set({ base: { ...doc.base, lineHeight: Number(e.target.value) } })}
              aria-label="Line spacing"
            />
          </Ctl>
          <Ctl label="Text colour" wide>
            <ColorField value={doc.base.color} colors={colors} onChange={(c) => set({ base: { ...doc.base, color: c ?? 'text' } })} />
          </Ctl>
        </div>
        {customFont && (
          <p className="xs muted">
            Email apps draw text with the reader’s own fonts. People who have {customFont} installed see it; everyone else sees{' '}
            {FONTS[doc.base.fallback ?? 'arial']}. The preview here also uses this computer’s fonts. For an exact look everywhere, use an
            image (SVG) design.
          </p>
        )}
        <label className="switch">
          <input type="checkbox" checked={doc.greeting.show} onChange={(e) => set({ greeting: { ...doc.greeting, show: e.target.checked } })} />
          <span>Show the closing line above the signature (text is set in Brand and footer)</span>
        </label>
      </section>

      <section className="stack">
        <div className="section-title">
          <h3>{doc.layout === 'textOnly' ? 'Signature lines' : 'Next to the logo'}</h3>
          <p>Drag to reorder. Empty fields are left out automatically.</p>
        </div>
        <BlockList zone="main" doc={doc} blocks={doc.main} colors={colors} open={open} setOpen={setOpen} onChange={(main) => set({ main })} />
      </section>

      <section className="stack">
        <div className="section-title">
          <h3>Below the signature</h3>
          <p>{kind === 'reply' ? 'Usually empty for replies.' : 'Banner, small print and extra lines.'}</p>
        </div>
        <BlockList zone="footer" doc={doc} blocks={doc.footer} colors={colors} open={open} setOpen={setOpen} onChange={(footer) => set({ footer })} />
      </section>
    </div>
  );
}

// ───────── Block list with drag and drop ─────────

function BlockList({
  zone,
  doc,
  blocks,
  colors,
  open,
  setOpen,
  onChange,
}: {
  zone: Zone;
  doc: BlockDoc;
  blocks: Block[];
  colors: Record<string, string>;
  open: string | null;
  setOpen: (id: string | null) => void;
  onChange: (blocks: Block[]) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to > blocks.length) return;
    const next = [...blocks];
    const [b] = next.splice(from, 1);
    next.splice(to > from ? to - 1 : to, 0, b);
    onChange(next);
  };
  const update = (i: number, b: Block) => onChange(blocks.map((x, j) => (j === i ? b : x)));
  const used = new Set([...doc.main, ...doc.footer].map((b) => b.type));

  return (
    <div className="blk-list" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}>
      {blocks.length === 0 && <div className="blk-empty">Nothing here yet. Add a block below.</div>}
      {blocks.map((b, i) => (
        <BlockRow
          key={b.id}
          block={b}
          doc={doc}
          colors={colors}
          expanded={open === b.id}
          dropBefore={over === i && drag !== null && drag !== i && drag !== i - 1}
          onToggle={() => setOpen(open === b.id ? null : b.id)}
          onChange={(nb) => update(i, nb)}
          onRemove={() => onChange(blocks.filter((_, j) => j !== i))}
          onUp={i > 0 ? () => move(i, i - 1) : undefined}
          onDown={i < blocks.length - 1 ? () => move(i, i + 2) : undefined}
          dragProps={{
            draggable: true,
            onDragStart: (e) => {
              setDrag(i);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', b.id);
            },
            onDragEnd: () => {
              setDrag(null);
              setOver(null);
            },
            onDragOver: (e) => {
              if (drag === null) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              setOver(e.clientY < r.top + r.height / 2 ? i : i + 1);
            },
            onDrop: (e) => {
              e.preventDefault();
              if (drag !== null && over !== null) move(drag, over);
              setDrag(null);
              setOver(null);
            },
          }}
        />
      ))}
      {drag !== null && over === blocks.length && <div className="blk-drop-end" />}
      <AddBlock zone={zone} used={used} onAdd={(t) => {
        const nb = newBlock(t);
        onChange([...blocks, nb]);
        setOpen(nb.id);
      }} />
    </div>
  );
}

function BlockRow({
  block: b,
  doc,
  colors,
  expanded,
  dropBefore,
  onToggle,
  onChange,
  onRemove,
  onUp,
  onDown,
  dragProps,
}: {
  block: Block;
  doc: BlockDoc;
  colors: Record<string, string>;
  expanded: boolean;
  dropBefore: boolean;
  onToggle: () => void;
  onChange: (b: Block) => void;
  onRemove: () => void;
  onUp?: () => void;
  onDown?: () => void;
  dragProps: React.HTMLAttributes<HTMLDivElement> & { draggable: boolean };
}) {
  const info = BLOCK_INFO[b.type];
  const eff = effectiveStyle(doc, b);
  const summary = hasStyle(b)
    ? [`${eff.size}pt`, eff.bold && 'bold', eff.italic && 'italic', eff.uppercase && 'capitals'].filter(Boolean).join(' · ')
    : b.type === 'spacer'
      ? `${b.height}px`
      : b.type === 'divider'
        ? `${b.thickness}px line`
        : '';
  const detail =
    b.type === 'text' ? b.text || 'Empty text' : 'label' in b && b.label ? `“${b.label}”` : b.type === 'websites' ? (b.arrangement === 'inline' ? 'In one line' : 'One per line') : '';

  return (
    <div className={`blk-row ${expanded ? 'open' : ''} ${b.hidden ? 'is-hidden' : ''} ${dropBefore ? 'drop-before' : ''}`} {...dragProps}>
      <div className="blk-head">
        <span className="blk-grip" aria-hidden title="Drag to reorder">
          <GripVertical size={16} />
        </span>
        <button type="button" className="blk-title" onClick={onToggle} aria-expanded={expanded}>
          <span className="blk-name">
            {info.label}
            {hasStyle(b) && eff.color && <span className="blk-dot" style={{ background: resolveColor(eff.color, colors) }} aria-hidden />}
          </span>
          <span className="blk-meta">
            {[summary, detail].filter(Boolean).join(' — ')}
            {b.hidden && ' — hidden'}
          </span>
        </button>
        <div className="blk-actions">
          <button type="button" className="icon-btn" onClick={onUp} disabled={!onUp} aria-label={`Move ${info.label} up`}>
            <ArrowUp size={14} />
          </button>
          <button type="button" className="icon-btn" onClick={onDown} disabled={!onDown} aria-label={`Move ${info.label} down`}>
            <ArrowDown size={14} />
          </button>
          <button type="button" className="icon-btn" onClick={() => onChange({ ...b, hidden: !b.hidden } as Block)} aria-label={b.hidden ? `Show ${info.label}` : `Hide ${info.label}`} title={b.hidden ? 'Show' : 'Hide without deleting'}>
            {b.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button type="button" className="icon-btn danger" onClick={onRemove} aria-label={`Remove ${info.label}`}>
            <Trash2 size={14} />
          </button>
          <button type="button" className="icon-btn" onClick={onToggle} aria-label={expanded ? 'Close settings' : 'Open settings'}>
            <ChevronDown size={16} style={{ transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="blk-body" onDragStart={(e) => e.preventDefault()} draggable={false}>
          <BlockSettings block={b} doc={doc} colors={colors} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function BlockSettings({ block: b, doc, colors, onChange }: { block: Block; doc: BlockDoc; colors: Record<string, string>; onChange: (b: Block) => void }) {
  const info = BLOCK_INFO[b.type];
  const language = useContext(LanguageCtx);
  const setStyle = (patch: Partial<BlockStyle>) => {
    if (!hasStyle(b)) return;
    const style = { ...b.style, ...patch };
    for (const k of Object.keys(style) as (keyof BlockStyle)[]) if (style[k] === undefined) delete style[k];
    onChange({ ...b, style } as Block);
  };
  const eff = effectiveStyle(doc, b);

  return (
    <div className="stack">
      <p className="xs muted">
        {info.hint}
        {info.source === 'Person' && '. Left out for people who don’t have it.'}
        {info.source === 'Brand' && '. Left out when it’s empty.'}
      </p>
      {b.type === 'jobTitleEn' && language && language !== 'bilingual' && (
        <p className="callout warn xs" role="note">
          {language === 'lv'
            ? 'Not shown: this design uses Latvian job titles only. Change “Job titles in this design” above the preview.'
            : 'Stays empty: this design uses English job titles, shown in the Job title (LV) line. Change “Job titles in this design” above the preview.'}
        </p>
      )}

      {b.type === 'text' && (
        <Ctl label="Text">
          <textarea rows={2} style={{ fontFamily: 'var(--font)', fontSize: 'var(--t-sm)' }} value={b.text} onChange={(e) => onChange({ ...b, text: e.target.value })} />
        </Ctl>
      )}
      {'label' in b && (
        <Ctl label="Label before the value">
          <input type="text" value={b.label} maxLength={40} onChange={(e) => onChange({ ...b, label: e.target.value } as Block)} placeholder="None" />
        </Ctl>
      )}
      {b.type === 'websites' && (
        <div className="ctl-grid">
          <Ctl label="Arrangement">
            <div className="segmented" role="group">
              <button type="button" aria-pressed={b.arrangement === 'stack'} onClick={() => onChange({ ...b, arrangement: 'stack' })}>
                One per line
              </button>
              <button type="button" aria-pressed={b.arrangement === 'inline'} onClick={() => onChange({ ...b, arrangement: 'inline' })}>
                In one line
              </button>
            </div>
          </Ctl>
          {b.arrangement === 'inline' && (
            <Ctl label="Separator">
              <input type="text" value={b.separator} maxLength={10} onChange={(e) => onChange({ ...b, separator: e.target.value })} />
            </Ctl>
          )}
        </div>
      )}
      {b.type === 'spacer' && (
        <Ctl label="Height">
          <Stepper value={b.height} min={1} max={60} unit="px" onChange={(v) => onChange({ ...b, height: v ?? 8 })} />
        </Ctl>
      )}
      {b.type === 'divider' && (
        <div className="ctl-grid">
          <Ctl label="Thickness">
            <Stepper value={b.thickness} min={1} max={6} unit="px" onChange={(v) => onChange({ ...b, thickness: v ?? 1 })} />
          </Ctl>
          <Ctl label="Space after">
            <Stepper value={b.spaceAfter} min={0} max={48} unit="px" onChange={(v) => onChange({ ...b, spaceAfter: v ?? 0 })} />
          </Ctl>
          <Ctl label="Colour" wide>
            <ColorField value={b.color} colors={colors} onChange={(c) => onChange({ ...b, color: c ?? 'rule' })} />
          </Ctl>
        </div>
      )}
      {b.type === 'banner' && (
        <>
          <BannerPicker block={b} onChange={onChange} />
          <Ctl label="Space after">
            <Stepper value={b.spaceAfter} min={0} max={48} unit="px" onChange={(v) => onChange({ ...b, spaceAfter: v ?? 0 })} />
          </Ctl>
        </>
      )}

      {hasStyle(b) && (
        <>
          <div className="ctl-grid">
            <Ctl label="Size">
              <Stepper value={b.style.size} placeholder={eff.size} min={6} max={36} step={0.5} unit="pt" onChange={(v) => setStyle({ size: v })} />
            </Ctl>
            <Ctl label="Style">
              <div className="segmented toggles" role="group" aria-label="Text style">
                <button type="button" aria-pressed={!!eff.bold} onClick={() => setStyle({ bold: !eff.bold })} title="Bold">
                  <Bold size={14} />
                </button>
                <button type="button" aria-pressed={!!eff.italic} onClick={() => setStyle({ italic: !eff.italic })} title="Italic">
                  <Italic size={14} />
                </button>
                <button type="button" aria-pressed={!!eff.uppercase} onClick={() => setStyle({ uppercase: !eff.uppercase })} title="Capitals">
                  <CaseUpper size={14} />
                </button>
              </div>
            </Ctl>
            <Ctl label="Space after">
              <Stepper value={b.style.spaceAfter} placeholder={eff.spaceAfter ?? 0} min={0} max={48} unit="px" onChange={(v) => setStyle({ spaceAfter: v })} />
            </Ctl>
          </div>
          <Ctl label="Colour">
            <ColorField value={b.style.color} inherit={eff.color ?? doc.base.color} colors={colors} onChange={(c) => setStyle({ color: c })} />
          </Ctl>
        </>
      )}
    </div>
  );
}

function BannerPicker({ block: b, onChange }: { block: Extract<Block, { type: 'banner' }>; onChange: (b: Block) => void }) {
  const { company, defaultBanner } = useContext(BannerCtx);
  const assets = useAsync(
    () => (company ? api.get<{ name: string; localUrl: string }[]>(`/api/admin/assets/${company}`) : Promise.resolve([])),
    [company],
  );
  const banners = (assets.data ?? []).filter((a) => a.name.startsWith('banner-'));
  const label = (file: string) => file.replace(/^banner-/, '');
  const pick = (file: string) => {
    if (!file) {
      const { image: _i, ...rest } = b;
      return onChange(rest);
    }
    const img = new Image();
    img.onload = () => {
      const width = Math.min(600, img.naturalWidth);
      const height = Math.max(1, Math.round((img.naturalHeight * width) / img.naturalWidth));
      onChange({ ...b, image: { link: b.image?.link ?? '', alt: b.image?.alt ?? '', file, width, height } });
    };
    img.src = banners.find((x) => x.name === file)?.localUrl ?? '';
  };
  const thumb = banners.find((x) => x.name === (b.image?.file ?? defaultBanner))?.localUrl;
  return (
    <div className="stack tight">
      <Ctl label="Banner image" wide>
        <select value={b.image?.file ?? ''} onChange={(e) => pick(e.target.value)}>
          <option value="">{defaultBanner ? `This design’s banner (${label(defaultBanner)})` : 'This design’s banner (none set)'}</option>
          {banners.map((x) => (
            <option key={x.name} value={x.name}>
              {label(x.name)}
            </option>
          ))}
        </select>
      </Ctl>
      {thumb && <img src={thumb} alt="" style={{ maxWidth: '100%', maxHeight: 90, objectFit: 'contain', alignSelf: 'flex-start', border: '1px solid var(--line)', borderRadius: 4 }} />}
      {b.image && (
        <div className="ctl-grid">
          <Ctl label="Link when clicked">
            <input type="url" placeholder="https://…" value={b.image.link ?? ''} maxLength={500} onChange={(e) => onChange({ ...b, image: { ...b.image!, link: e.target.value } })} />
          </Ctl>
          <Ctl label="Text if images are blocked">
            <input type="text" value={b.image.alt ?? ''} maxLength={200} onChange={(e) => onChange({ ...b, image: { ...b.image!, alt: e.target.value } })} />
          </Ctl>
        </div>
      )}
      <p className="xs muted">
        Pick the banner in this layout’s language, e.g. the English promo in the EN design. Upload banners in Brand and footer.
      </p>
    </div>
  );
}

function AddBlock({ zone, used, onAdd }: { zone: Zone; used: Set<BlockType>; onAdd: (t: BlockType) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const types = (Object.keys(BLOCK_INFO) as BlockType[]).filter((t) => BLOCK_INFO[t].zones.includes(zone));

  return (
    <div className="add-block" ref={ref}>
      <button type="button" className="btn sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Plus size={14} /> Add block
      </button>
      {open && (
        <div className="add-menu" role="menu">
          {types.map((t) => {
            const taken = used.has(t) && !BLOCK_INFO[t].repeatable;
            return (
              <button
                key={t}
                type="button"
                role="menuitem"
                disabled={taken}
                onClick={() => {
                  onAdd(t);
                  setOpen(false);
                }}
              >
                <strong>{BLOCK_INFO[t].label}</strong>
                <span>{taken ? 'Already in this design' : BLOCK_INFO[t].hint}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────── Small controls ─────────

function Ctl({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'ctl-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Number with −/+ buttons. Undefined = "use the default" (shown as placeholder). */
function Stepper({ value, onChange, min, max, step = 1, unit, placeholder }: { value: number | undefined; onChange: (v: number | undefined) => void; min: number; max: number; step?: number; unit: string; placeholder?: number }) {
  const shown = value ?? placeholder ?? min;
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  return (
    <div className="stepper">
      <button type="button" onClick={() => onChange(clamp(shown - step))} disabled={shown <= min} aria-label="Decrease">
        <Minus size={13} />
      </button>
      <input
        type="number"
        value={value ?? ''}
        placeholder={placeholder !== undefined ? String(placeholder) : undefined}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? undefined : clamp(Number(e.target.value)))}
      />
      <span className="unit">{unit}</span>
      <button type="button" onClick={() => onChange(clamp(shown + step))} disabled={shown >= max} aria-label="Increase">
        <Plus size={13} />
      </button>
    </div>
  );
}

function resolveColor(c: BlockColor, colors: Record<string, string>) {
  return c.startsWith('#') ? c : colors[c] ?? '#888888';
}

/** Brand colour chips (follow Brand and footer) or a custom hex colour. */
function ColorField({ value, onChange, colors, inherit }: { value: BlockColor | undefined; onChange: (c: BlockColor | undefined) => void; colors: Record<string, string>; inherit?: BlockColor }) {
  const custom = value?.startsWith('#') ? value : null;
  return (
    <div className="color-chips" role="radiogroup">
      {inherit !== undefined && (
        <button type="button" role="radio" aria-checked={value === undefined} onClick={() => onChange(undefined)} title="Use the default for this block">
          <span className="chip-swatch" style={{ background: resolveColor(inherit, colors) }} />
          Default
        </button>
      )}
      {(Object.keys(TOKEN_LABELS) as ColorToken[]).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} onClick={() => onChange(t)} title={`${TOKEN_LABELS[t]} colour from Brand and footer (${colors[t] ?? 'not set'})`}>
          <span className="chip-swatch" style={{ background: colors[t] ?? '#ccc' }} />
          {TOKEN_LABELS[t]}
        </button>
      ))}
      <label className={`chip-custom ${custom ? 'active' : ''}`} title="Custom colour">
        <input type="color" value={custom ?? '#000000'} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        {custom ?? 'Custom'}
      </label>
    </div>
  );
}

function LayoutCard({ active, onClick, label, art }: { active: boolean; onClick: () => void; label: string; art: 'side' | 'stacked' | 'textOnly' }) {
  const ink = 'currentColor';
  return (
    <button type="button" role="radio" aria-checked={active} className="layout-card" onClick={onClick}>
      <svg viewBox="0 0 96 56" width="96" height="56" aria-hidden>
        {art === 'side' && (
          <>
            <rect x="6" y="16" width="26" height="22" rx="2" fill={ink} opacity=".25" />
            <rect x="37" y="10" width="1.5" height="36" fill={ink} opacity=".5" />
            <rect x="43" y="12" width="34" height="5" rx="1.5" fill={ink} opacity=".7" />
            {[22, 29, 36, 43].map((y) => <rect key={y} x="43" y={y} width={y === 22 ? 26 : 42} height="3" rx="1.5" fill={ink} opacity=".35" />)}
          </>
        )}
        {art === 'stacked' && (
          <>
            <rect x="6" y="5" width="30" height="16" rx="2" fill={ink} opacity=".25" />
            <rect x="6" y="26" width="38" height="5" rx="1.5" fill={ink} opacity=".7" />
            {[35, 41, 47].map((y) => <rect key={y} x="6" y={y} width={y === 35 ? 30 : 52} height="3" rx="1.5" fill={ink} opacity=".35" />)}
          </>
        )}
        {art === 'textOnly' && (
          <>
            <rect x="6" y="8" width="2" height="40" fill={ink} opacity=".5" />
            <rect x="13" y="10" width="38" height="5" rx="1.5" fill={ink} opacity=".7" />
            {[20, 27, 34, 41].map((y) => <rect key={y} x="13" y={y} width={y === 20 ? 28 : 54} height="3" rx="1.5" fill={ink} opacity=".35" />)}
          </>
        )}
      </svg>
      <span>{label}</span>
    </button>
  );
}
