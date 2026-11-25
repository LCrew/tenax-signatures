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
import { dateLocale, msg, t, tn, tx } from '../lib/i18n';
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
    label: msg('New message'),
    sub: msg('Full signature layout'),
    lead: msg('The signature under new messages: name, job titles, phones, logo, websites and the promo banner.'),
    scope: 'design',
  },
  reply: {
    label: msg('Reply and forward'),
    sub: msg('Short signature layout'),
    lead: msg('The shorter signature under replies and forwards. Banners are never shown here.'),
    scope: 'design',
  },
  wording: {
    label: msg('Wording and job titles'),
    sub: msg('Titles, texts, banner on or off'),
    lead: msg('Which job titles this design shows and any wording that differs from the company’s.'),
    scope: 'design',
  },
  brand: {
    label: msg('Brand and footer'),
    sub: msg('Logo, colours, address, websites'),
    lead: msg('The company’s look and details, the same in every language.'),
    scope: 'company',
  },
  languages: {
    label: msg('Languages and banners'),
    sub: 'LV · EN · ET · LT',
    lead: msg('Closing line and promo banner for each signature language.'),
    scope: 'company',
  },
};
type Presets = Record<'side' | 'stacked' | 'textOnly' | 'reply', BlockDoc>;

const VARIABLES: [string, string][] = [
  ['{{user.displayName}}', msg('Name')],
  ['{{user.jobTitleLv}}', msg('First job title: Latvian, or Estonian / Lithuanian for those colleagues')],
  ['{{user.jobTitleEn}}', msg('English job title (empty on English-only designs)')],
  ['{{user.mobilePhone}}', msg('Mobile, formatted')],
  ['{{tel user.mobilePhone}}', msg('Mobile for tel: links')],
  ['{{user.officePhone}}', msg('Office phone')],
  ['{{user.email}}', msg('Email')],
  ['{{user.department}}', msg('Department')],
  ['{{company.displayName}}', msg('Company short name')],
  ['{{company.legalName}}', msg('Legal name')],
  ['{{meta.logoUrl}}', msg('Logo URL (absolute)')],
  ['{{meta.colors.primary}}', msg('Brand colour')],
  ['{{meta.footer.companyLine}}', msg('Company line')],
  ['{{meta.footer.address}}', msg('Address')],
  ['{{meta.greeting}}', msg('Closing line in the person’s language')],
  ['{{#each meta.websites}}{{label}}{{/each}}', msg('Websites (url, label)')],
  ['{{meta.bannerUrl}}', msg('Promo banner URL for the person’s language (empty when none)')],
  ['{{meta.footer.confidential}}', msg('Confidentiality notice')],
  ['{{#if user.mobilePhone}}…{{/if}}', msg('Leave a line out when empty')],
];

/** Caption under "Preview as" for each sample colleague. */
const SAMPLE_NOTE: Record<SignatureLocale, string> = {
  lv: msg('A sample Latvian colleague with every field filled in.'),
  en: msg('This design as if set to English only: English job title, English closing line and banner.'),
  et: msg('A sample Estonian colleague with every field filled in.'),
  lt: msg('A sample Lithuanian colleague with every field filled in.'),
};

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
          ? t('Saved. Every {company} design uses it from the next message.', { company: active.company.displayName })
          : t('Saved. {company} › {design} is used from the next message.', { company: active.company.displayName, design: activeDesign?.name ?? t('this design') }),
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
  const unsaved = (Object.keys(TABS) as EditorTab[]).filter((k) => tabDirty[k]).map((k) => t(TABS[k].label));
  const companyPeople = (users.data ?? []).filter((u) => u.company === active.company.key);
  const asPerson = (users.data ?? []).find((u) => u.upn === as);
  const scope = TABS[tab].scope === 'design' ? `${active.company.displayName} › ${activeDesign?.name ?? ''}` : t('Every {company} design', { company: active.company.displayName });

  const navItem = (k: EditorTab) => (
    <button key={k} type="button" role="tab" aria-selected={tab === k} className="designer-nav-item" onClick={() => setTab(k)}>
      <span className="designer-nav-text">
        <strong>{t(TABS[k].label)}</strong>
        <span>{t(TABS[k].sub)}</span>
      </span>
      {tabDirty[k] && <span className="dirty-dot" aria-label={t('Unsaved changes')} />}
    </button>
  );

  return (
    <>
      <PageHead
        title={t('Designs')}
        lead={t('Pick a company and one of its designs. A design has its own layouts and wording; the brand, languages and banners are shared by all of a company’s designs. Every save is kept as a version.')}
        actions={
          <>
            <button className="btn" onClick={() => setHistoryOpen(true)}>
              <History size={14} /> {t('Versions')}
            </button>
            {session?.isAdmin && <button
              className="btn"
              title={t("Import templates/<company>/* from the server's disk as new versions")}
              onClick={async () => {
                const r = await api.post<{ imported: number }>('/api/admin/templates/reload');
                toast(r.imported ? tn(r.imported, 'Imported {n} changed file from disk', 'Imported {n} changed files from disk') : t('Files on disk match the current versions'));
                await rows.reload();
              }}
            >
              <FolderSync size={14} /> {t('Reload from disk')}
            </button>}
          </>
        }
      />

      <div className="designer-picker">
        <div className="tabs" role="tablist" aria-label={t('Company')}>
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
        <nav className="designer-nav" role="tablist" aria-label={t('What to edit')}>
          <div className="designer-nav-group">
            <span className="designer-nav-label">{t('This design')} · {activeDesign?.name}</span>
            {navItem('new')}
            {navItem('reply')}
            {navItem('wording')}
          </div>
          <div className="designer-nav-group">
            <span className="designer-nav-label">{t('{company} · all designs', { company: active.company.displayName })}</span>
            {navItem('brand')}
            {navItem('languages')}
          </div>
        </nav>

        <section className="panel designer-pane" role="tabpanel" aria-label={t(TABS[tab].label)}>
          <div className="designer-pane-head">
            <div>
              <span className={`scope-tag ${TABS[tab].scope}`}>{TABS[tab].scope === 'design' ? t('This design') : t('Whole company')}</span>
              <h2>{t(TABS[tab].label)}</h2>
              <p className="small muted">
                {t(TABS[tab].lead)} <span className="nowrap">{t('Applies to: {scope}.', { scope })}</span>
              </p>
            </div>
            {(tab === 'new' || tab === 'reply') && session?.isAdmin && (
              <Segmented<'visual' | 'html'>
                label={t('Editor')}
                value={blockDrafts[tab] ? 'visual' : 'html'}
                options={[
                  { value: 'visual', label: t('Visual') },
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
                <div className="callout danger">{t('The company settings aren’t valid JSON. Fix them under Brand and footer › Edit as JSON, or discard your changes.')}</div>
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
                      {t('This design is hand-written HTML maintained by IT. You can replace it with a visual layout; the current version stays in Versions.')}
                    </span>
                    <button className="btn sm" onClick={() => setToVisual(tab)}>
                      {t('Start a visual layout')}
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
                    <p className="xs muted">{t('Email HTML: tables and inline styles, max 600px wide.')}</p>
                    <div className="editor">
                      <CodeMirror
                        value={drafts[tab]}
                        height="520px"
                        extensions={[htmlLang()]}
                        onChange={(v) => setDrafts((d) => ({ ...d, [tab]: v }))}
                        basicSetup={{ foldGutter: false, highlightActiveLine: false }}
                        aria-label={t('{section} template', { section: t(TABS[tab].label) })}
                      />
                    </div>
                    <details>
                      <summary className="small" style={{ cursor: 'pointer', fontWeight: 600 }}>
                        {t('Fields you can use')}
                      </summary>
                      <table className="data" style={{ marginTop: 8 }}>
                        <tbody>
                          {VARIABLES.map(([v, label]) => (
                            <tr key={v}>
                              <td className="mono xs">{v}</td>
                              <td className="xs muted">{t(label)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="xs muted" style={{ marginTop: 8 }}>
                        {t('Values are always HTML-escaped. Triple braces and scripts are rejected on save.')}
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
                  <span className="dirty-dot" aria-hidden /> {t('Not saved yet: {what}', { what: unsaved.join(', ') || t('changes') })}
                </>
              ) : (
                <span className="muted">{t('All changes saved')}</span>
              )}
            </p>
            {anyDirty && (
              <>
                <input type="text" placeholder={t('What changed? (optional)')} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('Version note')} />
                <button className="btn ghost" disabled={saving} onClick={discard}>
                  {t('Discard')}
                </button>
              </>
            )}
            <button className="btn primary" disabled={!anyDirty || saving || !!preview.error} onClick={save} title={preview.error ? t('Fix the error shown in the preview first') : undefined}>
              {saving ? t('Saving…') : t('Save version')}
            </button>
          </div>
        </section>

        <aside className="designer-preview" aria-label={t('Preview')}>
          <div className="stack">
            <div className="stack tight">
              <span className="designer-nav-label">{t('Preview as')}</span>
              <Segmented<SignatureLocale | ''>
                label={t('Sample colleague')}
                value={as ? '' : sample}
                options={LOCALES.map((l) => ({ value: l, label: t(LOCALE_NAMES[l]) }))}
                onChange={(l) => {
                  if (!l) return;
                  setSample(l);
                  setAs('');
                }}
              />
              <p className="xs muted">
                {as ? t('{name}, with their own details and language.', { name: asPerson?.displayName ?? as }) : t(SAMPLE_NOTE[sample])}
              </p>
            </div>
            <select value={as} onChange={(e) => setAs(e.target.value)} aria-label={t('Or a real person')}>
              <option value="">{t('…or pick a real person')}</option>
              {(users.data ?? []).map((u) => (
                <option key={u.upn} value={u.upn}>
                  {u.displayName ?? u.upn}
                  {u.language ? ` (${t(LOCALE_NAMES[u.language])})` : ''}
                  {u.company !== active.company.key ? ` (${t('normally {company}', { company: u.companyName })})` : ''}
                </option>
              ))}
            </select>
            <LetterPreview html={preview.data ?? null} error={preview.error?.message} loading={preview.loading} type={previewType} onTypeChange={setPreviewType} />
            <p className="xs muted">
              {t('{design}: new v{new}, reply v{reply} · company v{company}', {
                design: activeDesign?.name ?? '',
                new: activeDesign?.new?.version ?? '–',
                reply: activeDesign?.reply?.version ?? '–',
                company: active.meta?.version ?? '–',
              })}
              {activeDesign?.new && <> · {t('last saved {when}', { when: timeAgo([activeDesign.new, activeDesign.reply, active.meta].filter(Boolean).map((v) => v!.createdAt).sort().pop()) })}</>}
            </p>
          </div>
        </aside>
      </div>
      )}

      <VersionsModal open={historyOpen} onClose={() => setHistoryOpen(false)} company={active.company} design={activeDesign} onRestored={() => {
        setRestoreTick((t) => t + 1);
        void rows.reload();
      }} />
      <Modal open={!!confirmLeave} onClose={() => setConfirmLeave(null)} title={t('Discard unsaved changes?')}>
        <p>{t('You changed {company} › {design} without saving. Switching throws those changes away.', { company: active.company.displayName, design: activeDesign?.name ?? '' })}</p>
        <div className="row end">
          <button className="btn ghost" onClick={() => setConfirmLeave(null)}>
            {t('Keep editing')}
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
            {t('Discard changes')}
          </button>
        </div>
      </Modal>
      <Modal open={!!toHtml} onClose={() => setToHtml(null)} title={t('Edit this design as HTML?')}>
        <p>
          {t("You'll get the HTML the visual editor produces and can change anything. Once saved as HTML, the visual editor can't read it back; to return, restore an earlier version or start a new visual layout.")}
        </p>
        <div className="row end">
          <button className="btn ghost" onClick={() => setToHtml(null)}>
            {t('Stay in Visual')}
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              const k = toHtml!;
              setToHtml(null);
              await convertToHtml(k);
            }}
          >
            {t('Edit as HTML')}
          </button>
        </div>
      </Modal>
      <Modal open={!!toVisual} onClose={() => setToVisual(null)} title={t('Start a visual layout')}>
        <p>{t('This design is hand-written HTML. Pick a starting layout; it replaces the HTML when you save (the current version stays in Versions).')}</p>
        <div className="preset-cards">
          {(
            [
              ['side', msg('Logo beside text')],
              ['stacked', msg('Logo above text')],
              ['textOnly', msg('Text only')],
              ['reply', msg('Compact (for replies)')],
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
              <strong style={{ fontSize: 'var(--t-sm)', color: 'var(--ink)' }}>{t(label)}</strong>
            </button>
          ))}
        </div>
        <div className="row end">
          <button className="btn ghost" onClick={() => setToVisual(null)}>
            {t('Keep HTML')}
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
        {!meta && <div className="callout danger">{t("This isn't valid JSON yet. Fix it here or discard your changes.")}</div>}
        <div className="editor">
          <CodeMirror value={metaText} height="360px" extensions={[jsonLang()]} onChange={onChange} basicSetup={{ foldGutter: false }} />
        </div>
        {meta && (
          <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRaw(false)}>
            {t('Back to the form')}
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
    if (file.size > 650_000) return toast(t('Keep logos under 650 KB. Export them at 2× size as PNG.'), 'error');
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
      toast(t('Logo uploaded'));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  return (
    <div className="stack loose">
      <section className="stack">
        <h3>{t('Logo')}</h3>
        <div className="logo-pick">
          {logos.map((a) => (
            <button key={a.name} type="button" aria-pressed={logo.file === a.name} onClick={() => patch((m) => (m.logo = { ...logo, file: a.name }))}>
              <img src={a.localUrl} alt="" />
              {a.name}
            </button>
          ))}
          <label className="btn" style={{ height: 'auto', minHeight: 72, flexDirection: 'column' }}>
            <Upload size={16} /> {t('Upload')}
            <input type="file" accept="image/png,image/jpeg,image/gif" className="visually-hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        </div>
        <div className="grid-2">
          <Field label={t('Shown width (px)')} hint={t('Upload the image at twice this size so it stays sharp')}>
            <input type="number" min={10} max={600} value={logo.width} onChange={(e) => patch((m) => (m.logo = { ...logo, width: Number(e.target.value) }))} />
          </Field>
          <Field label={t('Shown height (px)')}>
            <input type="number" min={10} max={300} value={logo.height} onChange={(e) => patch((m) => (m.logo = { ...logo, height: Number(e.target.value) }))} />
          </Field>
        </div>
        <p className="xs muted">{t('Use a logo on a solid background. Transparent logos with dark text disappear in dark mode.')}</p>
      </section>

      <section className="stack">
        <h3>{t('Colours')}</h3>
        <div className="grid-2">
          {(
            [
              ['primary', msg('Brand colour'), msg('Links and the divider line')],
              ['text', msg('Text'), msg('Phone numbers, company and address')],
              ['name', msg('Name'), msg('Your name, in bold')],
              ['title', msg('Job title'), msg('The first job title (Latvian, Estonian or Lithuanian)')],
              ['muted', msg('Secondary text'), msg('The English title under it and the confidentiality notice')],
            ] as const
          ).map(([k, label, hint]) => (
            <Field key={k} label={t(label)} hint={t(hint)}>
              <div className="color-input">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(colors[k] ?? '') ? colors[k] : '#000000'} onChange={(e) => patch((m) => (m.colors = { ...colors, [k]: e.target.value.toUpperCase() }))} aria-label={t('{label} picker', { label: t(label) })} />
                <input type="text" className="mono" value={colors[k] ?? ''} onChange={(e) => patch((m) => (m.colors = { ...colors, [k]: e.target.value }))} />
              </div>
            </Field>
          ))}
        </div>
      </section>

      <section className="stack">
        <h3>{t('Company details')}</h3>
        <p className="xs muted">{t('The same in every language, also for Estonian and Lithuanian colleagues. Closing lines and promo banners are under Languages and banners.')}</p>
        <Field label={t('Company line')} hint={t('e.g. SIA “TENAPORS”. The legal name set under Companies is {legalName}.', { legalName: company.legalName })}>
          <input type="text" value={footer.companyLine ?? ''} onChange={(e) => patch((m) => (m.footer = { ...footer, companyLine: e.target.value }))} />
        </Field>
        <div className="grid-2">
          <Field label={t('Address')}>
            <input type="text" value={footer.address ?? ''} onChange={(e) => patch((m) => (m.footer = { ...footer, address: e.target.value }))} />
          </Field>
          <Field label={t('Registration number')} hint={t('Optional')}>
            <input type="text" value={footer.registrationNumber ?? ''} onChange={(e) => patch((m) => (m.footer = { ...footer, registrationNumber: e.target.value }))} />
          </Field>
        </div>
        <Field label={t('Confidentiality notice')} hint={t('Small italic text under the signature. Leave empty to leave it out.')}>
          <textarea rows={3} style={{ fontFamily: 'var(--font)', fontSize: 'var(--t-sm)' }} value={footer.confidential ?? ''} onChange={(e) => patch((m) => (m.footer = { ...footer, confidential: e.target.value }))} />
        </Field>
      </section>

      <section className="stack">
        <h3>{t('Websites')}</h3>
        {websites.map((w, i) => (
          <div className="row" key={i} style={{ flexWrap: 'nowrap' }}>
            <input type="text" aria-label={t('Shown as')} placeholder="www.tenapors.lv" value={w.label} onChange={(e) => patch((m) => (m.websites = websites.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))))} />
            <input type="url" aria-label={t('Link')} placeholder="https://www.tenapors.lv" value={w.url ?? ''} onChange={(e) => patch((m) => (m.websites = websites.map((x, j) => (j === i ? { ...x, url: e.target.value } : x))))} />
            <button type="button" className="btn ghost sm" aria-label={t('Remove {name}', { name: w.label })} onClick={() => patch((m) => (m.websites = websites.filter((_, j) => j !== i)))}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <button type="button" className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => patch((m) => (m.websites = [...websites, { label: '', url: '' }]))}>
          <Plus size={14} /> {t('Add website')}
        </button>
      </section>

      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRaw(true)}>
        {t('Edit as JSON')}
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
  const label: Record<TemplateKind, string> = { new: t('New message'), reply: t('Reply'), meta: t('Company brand and languages'), image: t('Image (SVG)'), wording: t('Wording and job titles') };
  const latest = new Map<string, number>();
  for (const v of list.data ?? []) latest.set(v.kind, Math.max(latest.get(v.kind) ?? 0, v.version));
  // Newest first, as a timeline of saves across all parts of the design.
  const rows = [...(list.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  const when = (iso: string) => new Date(iso).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'medium' });

  const restoreOne = async (v: Omit<TemplateVersion, 'content'>) => {
    try {
      await api.post(`/api/admin/templates/restore/${v.id}`);
      toast(t('{part} restored to v{version}', { part: label[v.kind], version: v.version }));
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
      toast(r.restored.length ? t('Restored {parts} to {when}', { parts: r.restored.map((k) => label[k as TemplateKind]).join(', '), when: when(v.createdAt) }) : t('Everything already matches that point'));
      onRestored();
      await list.reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t('{name} versions', { name: `${company.displayName}${design ? ` › ${design.name}` : ''}` })}>
      <p className="xs muted">
        {tx('{restore} brings back one part. {restoreAll} brings the whole design (layouts, wording and the company brand) back to how it was right after that save. Restores are saved as new versions, so you can always go forward again.', {
          restore: <strong>{t('Restore')}</strong>,
          restoreAll: <strong>{t('Restore all to here')}</strong>,
        })}
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
                  <span className="xs muted">{t('Current')}</span>
                ) : (
                  <button className="btn sm" onClick={() => restoreOne(v)} title={t('Restore only the {part}', { part: (label[v.kind] ?? v.kind).toLowerCase() })}>
                    <RotateCcw size={13} /> {t('Restore')}
                  </button>
                )}
                {design && (
                  <button className="btn ghost sm" onClick={() => restoreAll(v)} title={t('Restore layouts, wording and brand to right after this save')}>
                    {t('Restore all to here')}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row end">
        <button className="btn" onClick={onClose}>
          {t('Close')}
        </button>
      </div>
    </Modal>
  );
}
