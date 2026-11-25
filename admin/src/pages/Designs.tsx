import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { html as htmlLang } from '@codemirror/lang-html';
import { json as jsonLang } from '@codemirror/lang-json';
import { FolderSync, History, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useDebounced, useToast } from '../lib/hooks';
import type { Company, ComposeType, Design, MetaOverrides, SignatureLocale, TemplateKind, TemplateVersion, UserSummary } from '../lib/types';
import { LOCALE_NAMES } from '../lib/types';
import { DesignBar, type TitleLanguage, WordingForm } from '../components/designs/DesignBar';
import { type Asset, useCompanyAssets } from '../components/designs/BannerPicker';
import { LanguagesForm, LOCALES, localeSummary } from '../components/designs/LanguagesForm';
import '../components/designs/designer.css';
import { ImageDesignEditor } from '../components/designs/ImageDesignEditor';
import { ErrorNote, Field, Loading, Modal, PageHead, Segmented, timeAgo } from '../components/ui';
import { BlockEditor } from '../components/blocks/BlockEditor';
import type { BlockDoc } from '../components/blocks/model';
import { LetterPreview } from '../components/LetterPreview';

type Layout = TemplateVersion & { blocks?: BlockDoc | null };
type DesignRow = Design & { new?: Layout; reply?: Layout };
interface Row {
  company: Company;
  meta?: TemplateVersion;
  designs: DesignRow[];
}
type EditKind = 'new' | 'reply' | 'meta';
type Drafts = Record<EditKind, string>;
type MsgKind = 'new' | 'reply';
type BlockDrafts = Record<MsgKind, BlockDoc | null>;
type EditorTab = 'new' | 'reply' | 'wording' | 'brand' | 'languages';

/** The editor's sections: three belong to the open design, two to the whole company. */
const TABS: Record<EditorTab, { label: string; sub: string; lead: string; scope: 'design' | 'company' }> = {
  new: {
    label: 'New message',
    sub: 'Full signature layout',
    lead: 'The signature under new messages: name, job titles, phones, logo, websites and the promo banner.',
    scope: 'design',
  },
  reply: {
    label: 'Reply and forward',
    sub: 'Short signature layout',
    lead: 'The shorter signature under replies and forwards. Banners are never shown here.',
    scope: 'design',
  },
  wording: {
    label: 'Wording and job titles',
    sub: 'Titles, texts, banner on or off',
    lead: 'Which job titles this design shows and any wording that differs from the company’s.',
    scope: 'design',
  },
  brand: {
    label: 'Brand and footer',
    sub: 'Logo, colours, address, websites',
    lead: 'The company’s look and details, the same in every language.',
    scope: 'company',
  },
  languages: {
    label: 'Languages and banners',
    sub: 'LV · EN · ET · LT',
    lead: 'Closing line and promo banner for each signature language.',
    scope: 'company',
  },
};
type Presets = Record<'side' | 'stacked' | 'textOnly' | 'reply', BlockDoc>;

const VARIABLES: [string, string][] = [
  ['{{user.displayName}}', 'Name'],
  ['{{user.jobTitleLv}}', 'First job title: Latvian, or Estonian / Lithuanian for those colleagues'],
  ['{{user.jobTitleEn}}', 'English job title (empty on English-only designs)'],
  ['{{user.mobilePhone}}', 'Mobile, formatted'],
  ['{{tel user.mobilePhone}}', 'Mobile for tel: links'],
  ['{{user.officePhone}}', 'Office phone'],
  ['{{user.email}}', 'Email'],
  ['{{user.department}}', 'Department'],
  ['{{company.displayName}}', 'Company short name'],
  ['{{company.legalName}}', 'Legal name'],
  ['{{meta.logoUrl}}', 'Logo URL (absolute)'],
  ['{{meta.colors.primary}}', 'Brand colour'],
  ['{{meta.footer.companyLine}}', 'Company line'],
  ['{{meta.footer.address}}', 'Address'],
  ['{{meta.greeting}}', 'Closing line in the person’s language'],
  ['{{#each meta.websites}}{{label}}{{/each}}', 'Websites (url, label)'],
  ['{{meta.bannerUrl}}', 'Promo banner URL for the person’s language (empty when none)'],
  ['{{meta.footer.confidential}}', 'Confidentiality notice'],
  ['{{#if user.mobilePhone}}…{{/if}}', 'Leave a line out when empty'],
];

const safeParse = (s: string) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function Designs() {
  const { company: companyParam } = useParams();
  const { session } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const rows = useAsync(() => api.get<Row[]>('/api/admin/templates'));
  const presets = useAsync(() => api.get<Presets>('/api/admin/templates/presets'));
  const globalLanguage = useAsync(() => api.get<{ language: TitleLanguage }>('/api/admin/templates/language')).data?.language;
  const users = useAsync(() => api.get<UserSummary[]>('/api/admin/users').catch(() => [] as UserSummary[]));
  const active = rows.data?.find((r) => r.company.key === companyParam) ?? rows.data?.[0];
  const assets = useCompanyAssets(active?.company.key ?? '');
  const [designId, setDesignId] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<string | null>(null);
  const [restoreTick, setRestoreTick] = useState(0);
  useEffect(() => setDesignId(null), [active?.company.key]);
  const activeDesign = active?.designs.find((d) => d.id === designId) ?? active?.designs.find((d) => d.isDefault) ?? active?.designs[0];
  const [wording, setWording] = useState<MetaOverrides>({});
  const savedWording = useMemo(() => activeDesign?.metaOverrides ?? {}, [activeDesign]);
  useEffect(() => setWording(savedWording), [savedWording]);
  const wordingDirty = !same(wording, savedWording);
  // The design's job titles are a draft too, saved with its wording.
  const savedTitles: TitleLanguage | null = activeDesign?.language ?? null;
  const [titles, setTitles] = useState<TitleLanguage | null>(savedTitles);
  useEffect(() => setTitles(savedTitles), [savedTitles, activeDesign?.id]);
  const titlesDirty = titles !== savedTitles;

  const [tab, setTab] = useState<EditorTab>('new');
  const [drafts, setDrafts] = useState<Drafts>({ new: '', reply: '', meta: '' });
  const [blockDrafts, setBlockDrafts] = useState<BlockDrafts>({ new: null, reply: null });
  const [previewType, setPreviewType] = useState<ComposeType>('newMail');
  const [as, setAs] = useState('');
  /** Whose signature the preview shows when no real person is picked; also the card open under Languages and banners. */
  const [sample, setSample] = useState<SignatureLocale>('lv');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<string | null>(null);
  const [toHtml, setToHtml] = useState<MsgKind | null>(null);
  const [toVisual, setToVisual] = useState<MsgKind | null>(null);

  const saved: Drafts = useMemo(
    () => ({ new: activeDesign?.new?.content ?? '', reply: activeDesign?.reply?.content ?? '', meta: active?.meta?.content ?? '{}' }),
    [active, activeDesign],
  );
  const savedBlocks: BlockDrafts = useMemo(() => ({ new: activeDesign?.new?.blocks ?? null, reply: activeDesign?.reply?.blocks ?? null }), [activeDesign]);
  useEffect(() => {
    setDrafts(saved);
    setBlockDrafts(savedBlocks);
  }, [saved, savedBlocks]);

  const isDirty = (k: EditKind) =>
    k === 'meta' ? drafts.meta !== saved.meta : blockDrafts[k] ? !same(blockDrafts[k], savedBlocks[k]) : savedBlocks[k] !== null || drafts[k] !== saved[k];
  const dirtyKinds = (['new', 'reply', 'meta'] as EditKind[]).filter(isDirty);
  const anyDirty = dirtyKinds.length > 0 || wordingDirty || titlesDirty;

  // Keep the preview on what's being edited: the layout's message type; banners only show in new messages.
  useEffect(() => {
    if (tab === 'new' || tab === 'languages') setPreviewType('newMail');
    if (tab === 'reply') setPreviewType('reply');
  }, [tab]);

  const draftState = useMemo(() => ({ drafts, blockDrafts, wording, titles }), [drafts, blockDrafts, wording, titles]);
  const debounced = useDebounced(draftState, 300);
  const previewKind: MsgKind = previewType === 'newMail' ? 'new' : 'reply';
  const preview = useAsync(
    () =>
      active && debounced.drafts.meta // drafts are empty for one render before the saved versions load
        ? api.post<string>('/api/admin/templates/preview', {
            company: active.company.key,
            design: activeDesign?.id,
            metaOverrides: debounced.wording,
            designLanguage: debounced.titles,
            type: previewType,
            upn: as || undefined,
            language: as || sample === 'lv' ? undefined : sample,
            ...(debounced.blockDrafts[previewKind] ? { blocks: debounced.blockDrafts[previewKind] } : { template: debounced.drafts[previewKind] }),
            meta: debounced.drafts.meta,
          })
        : Promise.resolve(''),
    [active?.company.key, activeDesign?.id, previewType, as, sample, JSON.stringify(debounced)],
  );

  const switchCompany = (key: string) => {
    if (anyDirty) setConfirmLeave(key);
    else nav(`/designs/${key}`);
  };
  const switchDesign = (id: string) => {
    if (anyDirty) setConfirmLeave(`design:${id}`);
    else setDesignId(id);
  };

  const discard = () => {
    setDrafts(saved);
    setBlockDrafts(savedBlocks);
    setWording(savedWording);
    setTitles(savedTitles);
  };

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      // Brand first (layouts are trial-rendered against it), then this design's wording, then its layouts.
      if (dirtyKinds.includes('meta')) await api.post(`/api/admin/templates/${active.company.key}/meta`, { content: drafts.meta, note: note || undefined });
      if ((wordingDirty || titlesDirty) && activeDesign)
        await api.put(`/api/admin/designs/${activeDesign.id}`, { ...(wordingDirty ? { metaOverrides: wording } : {}), ...(titlesDirty ? { language: titles } : {}) });
      for (const kind of dirtyKinds.filter((k) => k !== 'meta')) {
        const payload = blockDrafts[kind] ? { blocks: blockDrafts[kind] } : { content: drafts[kind] };
        await api.post(`/api/admin/templates/${active.company.key}/${kind}`, { ...payload, design: activeDesign?.id, note: note || undefined });
      }
      setNote('');
      toast(
        dirtyKinds.includes('meta')
          ? `Saved. Every ${active.company.displayName} design uses it from the next message.`
          : `Saved. ${active.company.displayName} › ${activeDesign?.name ?? 'this design'} is used from the next message.`,
      );
      await rows.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function convertToHtml(kind: MsgKind) {
    try {
      const html = await api.post<string>('/api/admin/templates/compile', { kind, blocks: blockDrafts[kind] });
      setDrafts((d) => ({ ...d, [kind]: html }));
      setBlockDrafts((b) => ({ ...b, [kind]: null }));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  if (rows.error) return <ErrorNote error={rows.error} retry={rows.reload} />;
  if (!rows.data || !active) return <Loading />;

  const meta = safeParse(drafts.meta);
  const savedMeta = safeParse(saved.meta);
  const patchMeta = (fn: (m: any) => void) => {
    const next = structuredClone(meta);
    fn(next);
    setDrafts((d) => ({ ...d, meta: JSON.stringify(next, null, 2) + '\n' }));
  };
  // Brand and footer and Languages and banners are two views of the same company settings; tell them apart for the dots.
  const languagePart = (m: any) => ({ greeting: m?.greeting, banner: m?.banner, languages: m?.languages });
  const brandPart = (m: any) => {
    const { greeting: _g, banner: _b, languages: _l, ...rest } = m ?? {};
    return rest;
  };
  const metaDirty = dirtyKinds.includes('meta');
  const tabDirty: Record<EditorTab, boolean> = {
    new: dirtyKinds.includes('new'),
    reply: dirtyKinds.includes('reply'),
    wording: wordingDirty || titlesDirty,
    brand: metaDirty && (!meta || !same(brandPart(meta), brandPart(savedMeta))),
    languages: metaDirty && !!meta && !same(languagePart(meta), languagePart(savedMeta)),
  };
  const unsaved = (Object.keys(TABS) as EditorTab[]).filter((t) => tabDirty[t]).map((t) => TABS[t].label);
  const companyPeople = (users.data ?? []).filter((u) => u.company === active.company.key);
  const asPerson = (users.data ?? []).find((u) => u.upn === as);
  const scope = TABS[tab].scope === 'design' ? `${active.company.displayName} › ${activeDesign?.name ?? ''}` : `Every ${active.company.displayName} design`;

  const navItem = (t: EditorTab) => (
    <button key={t} type="button" role="tab" aria-selected={tab === t} className="designer-nav-item" onClick={() => setTab(t)}>
      <span className="designer-nav-text">
        <strong>{TABS[t].label}</strong>
        <span>{TABS[t].sub}</span>
      </span>
      {tabDirty[t] && <span className="dirty-dot" aria-label="unsaved changes" />}
    </button>
  );

  return (
    <>
      <PageHead
        title="Designs"
        lead="Pick a company and one of its designs. A design has its own layouts and wording; the brand, languages and banners are shared by all of a company’s designs. Every save is kept as a version."
        actions={
          <>
            <button className="btn" onClick={() => setHistoryOpen(true)}>
              <History size={14} /> Versions
            </button>
            {session?.isAdmin && <button
              className="btn"
              title="Import templates/<company>/* from the server's disk as new versions"
              onClick={async () => {
                const r = await api.post<{ imported: number }>('/api/admin/templates/reload');
                toast(r.imported ? `Imported ${r.imported} changed file(s) from disk` : 'Files on disk match the current versions');
                await rows.reload();
              }}
            >
              <FolderSync size={14} /> Reload from disk
            </button>}
          </>
        }
      />

      <div className="designer-picker">
        <div className="tabs" role="tablist" aria-label="Company">
          {rows.data.map((r) => {
            const color = safeParse(r.meta?.content ?? '{}')?.colors?.primary;
            return (
              <button key={r.company.key} role="tab" aria-selected={r.company.key === active.company.key} onClick={() => switchCompany(r.company.key)}>
                <span className="swatch" style={{ background: color }} aria-hidden /> {r.company.displayName}
              </button>
            );
          })}
        </div>

        {activeDesign && (
          <DesignBar
            company={active.company.key}
            companyName={active.company.displayName}
            designs={active.designs}
            activeId={activeDesign.id}
            onSelect={switchDesign}
            onChanged={async (id) => {
              await rows.reload();
              if (id) setDesignId(id);
            }}
            onUseImage={(id) => {
              setDesignId(id);
              setImageMode(id);
            }}
          />
        )}
      </div>

      {activeDesign && (activeDesign.format === 'image' || imageMode === activeDesign.id) ? (
        <ImageDesignEditor
          key={activeDesign.id}
          design={activeDesign}
          reloadKey={restoreTick}
          users={users.data ?? []}
          onSaved={() => void rows.reload()}
          onLeave={() => setImageMode(null)}
        />
      ) : (
      <div className="designer">
        <nav className="designer-nav" role="tablist" aria-label="What to edit">
          <div className="designer-nav-group">
            <span className="designer-nav-label">This design · {activeDesign?.name}</span>
            {navItem('new')}
            {navItem('reply')}
            {navItem('wording')}
          </div>
          <div className="designer-nav-group">
            <span className="designer-nav-label">{active.company.displayName} · all designs</span>
            {navItem('brand')}
            {navItem('languages')}
          </div>
        </nav>

        <section className="panel designer-pane" role="tabpanel" aria-label={TABS[tab].label}>
          <div className="designer-pane-head">
            <div>
              <span className={`scope-tag ${TABS[tab].scope}`}>{TABS[tab].scope === 'design' ? 'This design' : 'Whole company'}</span>
              <h2>{TABS[tab].label}</h2>
              <p className="small muted">
                {TABS[tab].lead} <span className="nowrap">Applies to: {scope}.</span>
              </p>
            </div>
            {(tab === 'new' || tab === 'reply') && session?.isAdmin && (
              <Segmented<'visual' | 'html'>
                label="Editor"
                value={blockDrafts[tab] ? 'visual' : 'html'}
                options={[
                  { value: 'visual', label: 'Visual' },
                  { value: 'html', label: 'HTML' },
                ]}
                onChange={(m) => {
                  if (m === 'html' && blockDrafts[tab]) setToHtml(tab);
                  if (m === 'visual' && !blockDrafts[tab]) {
                    if (savedBlocks[tab] && drafts[tab] === saved[tab]) setBlockDrafts((b) => ({ ...b, [tab]: savedBlocks[tab] }));
                    else setToVisual(tab);
                  }
                }}
              />
            )}
          </div>

          <div className="panel-body stack designer-body">
            {tab === 'brand' ? (
              <BrandForm company={active.company} metaText={drafts.meta} meta={meta} onChange={(m) => setDrafts((d) => ({ ...d, meta: m }))} assets={assets.data ?? []} onUploaded={() => void assets.reload()} />
            ) : tab === 'languages' ? (
              meta ? (
                <LanguagesForm
                  company={active.company.key}
                  companyName={active.company.displayName}
                  meta={meta}
                  patch={patchMeta}
                  assets={assets.data ?? []}
                  onUploaded={() => void assets.reload()}
                  selected={sample}
                  onSelect={(l) => {
                    setSample(l);
                    setAs('');
                  }}
                  people={companyPeople}
                />
              ) : (
                <div className="callout danger">The company settings aren’t valid JSON. Fix them under Brand and footer › Edit as JSON, or discard your changes.</div>
              )
            ) : tab === 'wording' ? (
              <WordingForm
                company={active.company.key}
                companyName={active.company.displayName}
                companyMeta={meta}
                value={wording}
                onChange={setWording}
                language={titles}
                globalLanguage={globalLanguage}
                onLanguageChange={setTitles}
                assets={assets.data ?? []}
                onUploaded={() => void assets.reload()}
              />
            ) : (
              <>
                {!session?.isAdmin && !blockDrafts[tab] && (
                  <div className="callout row">
                    <span style={{ flex: '1 1 240px' }}>
                      This design is hand-written HTML maintained by IT. You can replace it with a visual layout; the
                      current version stays in Versions.
                    </span>
                    <button className="btn sm" onClick={() => setToVisual(tab)}>
                      Start a visual layout
                    </button>
                  </div>
                )}
                {blockDrafts[tab] ? (
                  <BlockEditor
                    key={`${active.company.key}-${activeDesign?.id}-${tab}`}
                    doc={blockDrafts[tab]!}
                    kind={tab}
                    language={titles ?? globalLanguage}
                    company={active.company.key}
                    defaultBanner={(wording.banner !== undefined ? wording.banner : localeSummary(meta, sample).banner)?.file ?? null}
                    colors={meta?.colors ?? {}}
                    onChange={(d) => setBlockDrafts((b) => ({ ...b, [tab]: d }))}
                  />
                ) : !session?.isAdmin ? null : (
                  <>
                    <p className="xs muted">Email HTML: tables and inline styles, max 600px wide.</p>
                    <div className="editor">
                      <CodeMirror
                        value={drafts[tab]}
                        height="520px"
                        extensions={[htmlLang()]}
                        onChange={(v) => setDrafts((d) => ({ ...d, [tab]: v }))}
                        basicSetup={{ foldGutter: false, highlightActiveLine: false }}
                        aria-label={`${TABS[tab].label} template`}
                      />
                    </div>
                    <details>
                      <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
                        Fields you can use
                      </summary>
                      <table className="data" style={{ marginTop: 8 }}>
                        <tbody>
                          {VARIABLES.map(([v, label]) => (
                            <tr key={v}>
                              <td className="mono xs">{v}</td>
                              <td className="xs muted">{label}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="xs muted" style={{ marginTop: 8 }}>
                        Values are always HTML-escaped. Triple braces and scripts are rejected on save.
                      </p>
                    </details>
                  </>
                )}
              </>
            )}
          </div>

          <div className={`save-dock ${anyDirty ? 'dirty' : ''}`}>
            <p className="small save-dock-status" aria-live="polite">
              {anyDirty ? (
                <>
                  <span className="dirty-dot" aria-hidden /> Not saved yet: {unsaved.join(', ') || 'changes'}
                </>
              ) : (
                <span className="muted">All changes saved</span>
              )}
            </p>
            {anyDirty && (
              <>
                <input type="text" placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Version note" />
                <button className="btn ghost" disabled={saving} onClick={discard}>
                  Discard
                </button>
              </>
            )}
            <button className="btn primary" disabled={!anyDirty || saving || !!preview.error} onClick={save} title={preview.error ? 'Fix the error shown in the preview first' : undefined}>
              {saving ? 'Saving…' : 'Save version'}
            </button>
          </div>
        </section>

        <aside className="designer-preview" aria-label="Preview">
          <div className="stack">
            <div className="stack tight">
              <span className="designer-nav-label">Preview as</span>
              <Segmented<SignatureLocale | ''>
                label="Sample colleague"
                value={as ? '' : sample}
                options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
                onChange={(l) => {
                  if (!l) return;
                  setSample(l);
                  setAs('');
                }}
              />
              <p className="xs muted">
                {as
                  ? `${asPerson?.displayName ?? as}, with their own details and language.`
                  : sample === 'en'
                    ? 'This design as if set to English only: English job title, English closing line and banner.'
                    : `A sample ${LOCALE_NAMES[sample]} colleague with every field filled in.`}
              </p>
            </div>
            <select value={as} onChange={(e) => setAs(e.target.value)} aria-label="Or a real person">
              <option value="">…or pick a real person</option>
              {(users.data ?? []).map((u) => (
                <option key={u.upn} value={u.upn}>
                  {u.displayName ?? u.upn}
                  {u.language ? ` (${LOCALE_NAMES[u.language]})` : ''}
                  {u.company !== active.company.key ? ` (normally ${u.companyName})` : ''}
                </option>
              ))}
            </select>
            <LetterPreview html={preview.data ?? null} error={preview.error?.message} loading={preview.loading} type={previewType} onTypeChange={setPreviewType} />
            <p className="xs muted">
              {activeDesign?.name}: new v{activeDesign?.new?.version ?? '–'}, reply v{activeDesign?.reply?.version ?? '–'} · company v{active.meta?.version ?? '–'}
              {activeDesign?.new && <> · last saved {timeAgo([activeDesign.new, activeDesign.reply, active.meta].filter(Boolean).map((t) => t!.createdAt).sort().pop())}</>}
            </p>
          </div>
        </aside>
      </div>
      )}

      <VersionsModal open={historyOpen} onClose={() => setHistoryOpen(false)} company={active.company} design={activeDesign} onRestored={() => {
        setRestoreTick((t) => t + 1);
        void rows.reload();
      }} />
      <Modal open={!!confirmLeave} onClose={() => setConfirmLeave(null)} title="Discard unsaved changes?">
        <p>You changed {active.company.displayName} › {activeDesign?.name} without saving. Switching throws those changes away.</p>
        <div className="row end">
          <button className="btn ghost" onClick={() => setConfirmLeave(null)}>
            Keep editing
          </button>
          <button
            className="btn danger"
            onClick={() => {
              const k = confirmLeave!;
              setConfirmLeave(null);
              if (k.startsWith('design:')) {
                discard();
                setDesignId(k.slice(7));
              } else nav(`/designs/${k}`);
            }}
          >
            Discard changes
          </button>
        </div>
      </Modal>
      <Modal open={!!toHtml} onClose={() => setToHtml(null)} title="Edit this design as HTML?">
        <p>
          You'll get the HTML the visual editor produces and can change anything. Once saved as HTML, the visual editor
          can't read it back; to return, restore an earlier version or start a new visual layout.
        </p>
        <div className="row end">
          <button className="btn ghost" onClick={() => setToHtml(null)}>
            Stay in Visual
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              const k = toHtml!;
              setToHtml(null);
              await convertToHtml(k);
            }}
          >
            Edit as HTML
          </button>
        </div>
      </Modal>
      <Modal open={!!toVisual} onClose={() => setToVisual(null)} title="Start a visual layout">
        <p>This design is hand-written HTML. Pick a starting layout; it replaces the HTML when you save (the current version stays in Versions).</p>
        <div className="preset-cards">
          {(
            [
              ['side', 'Logo beside text'],
              ['stacked', 'Logo above text'],
              ['textOnly', 'Text only'],
              ['reply', 'Compact (for replies)'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className="layout-card"
              disabled={!presets.data}
              onClick={() => {
                const kind = toVisual!;
                setBlockDrafts((b) => ({ ...b, [kind]: structuredClone(presets.data![k]) }));
                setToVisual(null);
              }}
            >
              <strong style={{ fontSize: 'var(--t-sm)', color: 'var(--ink)' }}>{label}</strong>
            </button>
          ))}
        </div>
        <div className="row end">
          <button className="btn ghost" onClick={() => setToVisual(null)}>
            Keep HTML
          </button>
        </div>
      </Modal>
    </>
  );
}

// ───────── Brand + footer form (meta.json) ─────────
function BrandForm({
  company,
  metaText,
  meta,
  onChange,
  assets,
  onUploaded,
}: {
  company: Company;
  metaText: string;
  meta: any;
  onChange: (text: string) => void;
  assets: Asset[];
  onUploaded: () => void;
}) {
  const toast = useToast();
  const [raw, setRaw] = useState(false);

  if (raw || !meta) {
    return (
      <div className="stack">
        {!meta && <div className="callout danger">This isn't valid JSON yet. Fix it here or discard your changes.</div>}
        <div className="editor">
          <CodeMirror value={metaText} height="360px" extensions={[jsonLang()]} onChange={onChange} basicSetup={{ foldGutter: false }} />
        </div>
        {meta && (
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRaw(false)}>
            Back to the form
          </button>
        )}
      </div>
    );
  }

  const patch = (fn: (m: any) => void) => {
    const next = structuredClone(meta);
    fn(next);
    onChange(JSON.stringify(next, null, 2) + '\n');
  };
  const colors = meta.colors ?? {};
  const footer = meta.footer ?? {};
  const logo = meta.logo ?? { file: '', width: 120, height: 40 };
  const websites: { label: string; url?: string }[] = meta.websites ?? (footer.website ? [{ label: footer.website }] : []);
  const logos = assets.filter((a) => !a.name.startsWith('banner-'));

  /** Uploads a logo (a 2× export is assumed: it's shown at half its pixel size). */
  async function upload(file: File) {
    if (file.size > 650_000) return toast('Keep logos under 650 KB. Export them at 2× size as PNG.', 'error');
    const name = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+/, '').replace(/^banner-/, 'logo-');
    const dataBase64 = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(file);
    });
    try {
      await api.post(`/api/admin/assets/${company.key}`, { name, dataBase64 });
      const img = new Image();
      img.onload = () => patch((m) => (m.logo = { ...logo, file: name, width: Math.round(img.naturalWidth / 2), height: Math.round(img.naturalHeight / 2) }));
      img.src = URL.createObjectURL(file);
      onUploaded();
      toast('Logo uploaded');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="stack loose">
      <section className="stack">
        <h3>Logo</h3>
        <div className="logo-pick">
          {logos.map((a) => (
            <button key={a.name} type="button" aria-pressed={logo.file === a.name} onClick={() => patch((m) => (m.logo = { ...logo, file: a.name }))}>
              <img src={a.localUrl} alt="" />
              {a.name}
            </button>
          ))}
          <label className="btn" style={{ height: 'auto', minHeight: 72, flexDirection: 'column' }}>
            <Upload size={16} /> Upload
            <input type="file" accept="image/png,image/jpeg,image/gif" className="visually-hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
        <div className="grid-2">
          <Field label="Shown width (px)" hint="Upload the image at twice this size so it stays sharp">
            <input type="number" min={10} max={600} value={logo.width} onChange={(e) => patch((m) => (m.logo = { ...logo, width: Number(e.target.value) }))} />
          </Field>
          <Field label="Shown height (px)">
            <input type="number" min={10} max={300} value={logo.height} onChange={(e) => patch((m) => (m.logo = { ...logo, height: Number(e.target.value) }))} />
          </Field>
        </div>
        <p className="xs muted">Use a logo on a solid background. Transparent logos with dark text disappear in dark mode.</p>
      </section>

      <section className="stack">
        <h3>Colours</h3>
        <div className="grid-2">
          {(
            [
              ['primary', 'Brand colour', 'Links and the divider line'],
              ['text', 'Text', 'Phone numbers, company and address'],
              ['name', 'Name', 'Your name, in bold'],
              ['title', 'Job title', 'The first job title (Latvian, Estonian or Lithuanian)'],
              ['muted', 'Secondary text', 'The English title under it and the confidentiality notice'],
            ] as const
          ).map(([k, label, hint]) => (
            <Field key={k} label={label} hint={hint}>
              <div className="color-input">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(colors[k] ?? '') ? colors[k] : '#000000'} onChange={(e) => patch((m) => (m.colors = { ...colors, [k]: e.target.value.toUpperCase() }))} aria-label={`${label} picker`} />
                <input type="text" className="mono" value={colors[k] ?? ''} onChange={(e) => patch((m) => (m.colors = { ...colors, [k]: e.target.value }))} />
              </div>
            </Field>
          ))}
        </div>
      </section>

      <section className="stack">
        <h3>Company details</h3>
        <p className="xs muted">The same in every language, also for Estonian and Lithuanian colleagues. Closing lines and promo banners are under Languages and banners.</p>
        <Field label="Company line" hint={`e.g. SIA “TENAPORS”. The legal name set under Companies is ${company.legalName}.`}>
          <input type="text" value={footer.companyLine ?? ''} onChange={(e) => patch((m) => (m.footer = { ...footer, companyLine: e.target.value }))} />
        </Field>
        <div className="grid-2">
          <Field label="Address">
            <input type="text" value={footer.address ?? ''} onChange={(e) => patch((m) => (m.footer = { ...footer, address: e.target.value }))} />
          </Field>
          <Field label="Registration number" hint="Optional">
            <input type="text" value={footer.registrationNumber ?? ''} onChange={(e) => patch((m) => (m.footer = { ...footer, registrationNumber: e.target.value }))} />
          </Field>
        </div>
        <Field label="Confidentiality notice" hint="Small italic text under the signature. Leave empty to leave it out.">
          <textarea rows={3} style={{ fontFamily: 'var(--font)', fontSize: 'var(--t-sm)' }} value={footer.confidential ?? ''} onChange={(e) => patch((m) => (m.footer = { ...footer, confidential: e.target.value }))} />
        </Field>
      </section>

      <section className="stack">
        <h3>Websites</h3>
        {websites.map((w, i) => (
          <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
            <input type="text" aria-label="Shown as" placeholder="www.tenapors.lv" value={w.label} onChange={(e) => patch((m) => (m.websites = websites.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))))} />
            <input type="url" aria-label="Link" placeholder="https://www.tenapors.lv" value={w.url ?? ''} onChange={(e) => patch((m) => (m.websites = websites.map((x, j) => (j === i ? { ...x, url: e.target.value } : x))))} />
            <button type="button" className="btn ghost sm" aria-label={`Remove ${w.label}`} onClick={() => patch((m) => (m.websites = websites.filter((_, j) => j !== i)))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => patch((m) => (m.websites = [...websites, { label: '', url: '' }]))}>
          <Plus size={14} /> Add website
        </button>
      </section>

      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRaw(true)}>
        Edit as JSON
      </button>
    </div>
  );
}

// ───────── Versions ─────────
function VersionsModal({ open, onClose, company, design, onRestored }: { open: boolean; onClose: () => void; company: Company; design?: Design; onRestored: () => void }) {
  const toast = useToast();
  const list = useAsync(
    () => (open ? api.get<Omit<TemplateVersion, 'content'>[]>(`/api/admin/templates/${company.key}/history${design ? `?design=${encodeURIComponent(design.id)}` : ''}`) : Promise.resolve([])),
    [open, company.key, design?.id],
  );
  const label: Record<TemplateKind, string> = { new: 'New message', reply: 'Reply', meta: 'Company brand and languages', image: 'Image (SVG)', wording: 'Wording and job titles' };
  const latest = new Map<string, number>();
  for (const v of list.data ?? []) latest.set(v.kind, Math.max(latest.get(v.kind) ?? 0, v.version));
  // Newest first, as a timeline of saves across all parts of the design.
  const rows = [...(list.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const when = (iso: string) => new Date(iso).toLocaleString('lv-LV', { dateStyle: 'short', timeStyle: 'medium' });

  const restoreOne = async (v: Omit<TemplateVersion, 'content'>) => {
    try {
      await api.post(`/api/admin/templates/restore/${v.id}`);
      toast(`${label[v.kind]} restored to v${v.version}`);
      onRestored();
      await list.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const restoreAll = async (v: Omit<TemplateVersion, 'content'>) => {
    if (!design) return;
    try {
      const r = await api.post<{ restored: string[] }>(`/api/admin/designs/${encodeURIComponent(design.id)}/restore-to`, { at: v.createdAt });
      toast(r.restored.length ? `Restored ${r.restored.map((k) => label[k as TemplateKind]).join(', ')} to ${when(v.createdAt)}` : 'Everything already matches that point');
      onRestored();
      await list.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`${company.displayName}${design ? ` › ${design.name}` : ''} versions`}>
      <p className="xs muted">
        <strong>Restore</strong> brings back one part. <strong>Restore all to here</strong> brings the whole design (layouts,
        wording and the company brand) back to how it was right after that save. Restores are saved as new versions, so you
        can always go forward again.
      </p>
      {!list.data ? (
        <Loading />
      ) : (
        <ul className="history" style={{ maxHeight: 440, overflow: 'auto' }}>
          {rows.map((v) => (
            <li key={v.id} style={{ gridTemplateColumns: '44px 1fr auto' }}>
              <span className="tag">v{v.version}</span>
              <span>
                <strong>{label[v.kind] ?? v.kind}</strong> <span className="xs muted">· {v.createdBy} · {when(v.createdAt)}</span>
                {v.note && <div className="xs muted">{v.note}</div>}
              </span>
              <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                {latest.get(v.kind) === v.version ? (
                  <span className="xs muted">Current</span>
                ) : (
                  <button className="btn sm" onClick={() => restoreOne(v)} title={`Restore only the ${label[v.kind]?.toLowerCase()}`}>
                    <RotateCcw size={13} /> Restore
                  </button>
                )}
                {design && (
                  <button className="btn ghost sm" onClick={() => restoreAll(v)} title="Restore layouts, wording and brand to right after this save">
                    Restore all to here
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row end">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
