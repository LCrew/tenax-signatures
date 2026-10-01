import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { html as htmlLang } from '@codemirror/lang-html';
import { json as jsonLang } from '@codemirror/lang-json';
import { FolderSync, History, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { useApp, useAsync, useDebounced, useToast } from '../lib/hooks';
import type { Company, ComposeType, Design, MetaOverrides, TemplateKind, TemplateVersion, UserSummary } from '../lib/types';
import { DesignBar, WordingForm } from '../components/designs/DesignBar';
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
type EditorTab = 'brand' | 'new' | 'reply' | 'wording';
type Presets = Record<'side' | 'stacked' | 'textOnly' | 'reply', BlockDoc>;

const VARIABLES: [string, string][] = [
  ['{{user.displayName}}', 'Name'],
  ['{{user.jobTitleLv}}', 'Job title (LV)'],
  ['{{user.jobTitleEn}}', 'Job title (EN)'],
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
  ['{{meta.greeting}}', 'Closing line'],
  ['{{#each meta.websites}}{{label}}{{/each}}', 'Websites (url, label)'],
  ['{{meta.bannerUrl}}', 'Promo banner URL (empty when none)'],
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
  const users = useAsync(() => api.get<UserSummary[]>('/api/admin/users').catch(() => [] as UserSummary[]));
  const active = rows.data?.find((r) => r.company.key === companyParam) ?? rows.data?.[0];
  const [designId, setDesignId] = useState<string | null>(null);
  const [imageMode, setImageMode] = useState<string | null>(null);
  const [restoreTick, setRestoreTick] = useState(0);
  useEffect(() => setDesignId(null), [active?.company.key]);
  const activeDesign = active?.designs.find((d) => d.id === designId) ?? active?.designs.find((d) => d.isDefault) ?? active?.designs[0];
  const [wording, setWording] = useState<MetaOverrides>({});
  const savedWording = useMemo(() => activeDesign?.metaOverrides ?? {}, [activeDesign]);
  useEffect(() => setWording(savedWording), [savedWording]);
  const wordingDirty = !same(wording, savedWording);

  const [tab, setTab] = useState<EditorTab>('new');
  const [drafts, setDrafts] = useState<Drafts>({ new: '', reply: '', meta: '' });
  const [blockDrafts, setBlockDrafts] = useState<BlockDrafts>({ new: null, reply: null });
  const [previewType, setPreviewType] = useState<ComposeType>('newMail');
  const [as, setAs] = useState('');
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
  const anyDirty = dirtyKinds.length > 0 || wordingDirty;

  // Keep the preview on the template being edited.
  useEffect(() => {
    if (tab === 'new') setPreviewType('newMail');
    if (tab === 'reply') setPreviewType('reply');
  }, [tab]);

  const draftState = useMemo(() => ({ drafts, blockDrafts, wording }), [drafts, blockDrafts, wording]);
  const debounced = useDebounced(draftState, 300);
  const previewKind: MsgKind = previewType === 'newMail' ? 'new' : 'reply';
  const preview = useAsync(
    () =>
      active && debounced.drafts.meta // drafts are empty for one render before the saved versions load
        ? api.post<string>('/api/admin/templates/preview', {
            company: active.company.key,
            design: activeDesign?.id,
            metaOverrides: debounced.wording,
            type: previewType,
            upn: as || undefined,
            ...(debounced.blockDrafts[previewKind] ? { blocks: debounced.blockDrafts[previewKind] } : { template: debounced.drafts[previewKind] }),
            meta: debounced.drafts.meta,
          })
        : Promise.resolve(''),
    [active?.company.key, activeDesign?.id, previewType, as, JSON.stringify(debounced)],
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
  };

  async function save() {
    if (!active) return;
    setSaving(true);
    try {
      // Brand first (layouts are trial-rendered against it), then this design's wording, then its layouts.
      if (dirtyKinds.includes('meta')) await api.post(`/api/admin/templates/${active.company.key}/meta`, { content: drafts.meta, note: note || undefined });
      if (wordingDirty && activeDesign) await api.put(`/api/admin/designs/${activeDesign.id}`, { metaOverrides: wording });
      for (const kind of dirtyKinds.filter((k) => k !== 'meta')) {
        const payload = blockDrafts[kind] ? { blocks: blockDrafts[kind] } : { content: drafts[kind] };
        await api.post(`/api/admin/templates/${active.company.key}/${kind}`, { ...payload, design: activeDesign?.id, note: note || undefined });
      }
      setNote('');
      toast(`Saved. New messages with ${active.company.displayName} › ${activeDesign?.name ?? 'this design'} use it from now on.`);
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
  const tabLabel: Record<EditorTab, string> = { new: 'New message', reply: 'Reply and forward', wording: 'Wording', brand: 'Brand (company)' };
  const tabKind: Record<EditorTab, EditKind | 'wording'> = { brand: 'meta', new: 'new', reply: 'reply', wording: 'wording' };
  const tabDirty = (t: EditorTab) => (t === 'wording' ? wordingDirty : dirtyKinds.includes(tabKind[t] as EditKind));

  return (
    <>
      <PageHead
        title="Designs"
        lead="Each company can have several designs, e.g. Standard, English and Service. Changes apply to the next message people write. Every save is kept as a version you can go back to."
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
      <div className="split">
        <section className="panel">
          <div className="panel-head" style={{ paddingBottom: 0, borderBottom: 0 }}>
            <div className="tabs" role="tablist" aria-label="Part of the design" style={{ margin: 0, flex: 1 }}>
              {(Object.keys(tabLabel) as EditorTab[]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {tabLabel[t]}
                  {tabDirty(t) && <span className="dirty-dot" aria-label="unsaved changes" />}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-body stack">
            {tab === 'brand' ? (
              <>
                <p className="small muted">Shared by every {active.company.displayName} design. Each design can change some wording in its Wording tab.</p>
                <BrandForm company={active.company} metaText={drafts.meta} meta={meta} onChange={(m) => setDrafts((d) => ({ ...d, meta: m }))} />
              </>
            ) : tab === 'wording' ? (
              <WordingForm company={active.company.key} companyMeta={meta} value={wording} onChange={setWording} />
            ) : (
              <>
                <div className="mode-bar">
                  <p className="small muted" style={{ flex: '1 1 260px' }}>
                    {tab === 'new' ? 'The full signature for new messages and meeting invites.' : 'A shorter signature for replies and forwards.'}
                  </p>
                  {session?.isAdmin && <Segmented<'visual' | 'html'>
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
                  />}
                </div>
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
                    colors={meta?.colors ?? {}}
                    onChange={(d) => setBlockDrafts((b) => ({ ...b, [tab]: d }))}
                  />
                ) : !session?.isAdmin ? null : (
                  <>
                    <p className="xs muted">Email HTML: tables and inline styles, max 600px wide.</p>
                    <div className="editor">
                      <CodeMirror
                        value={drafts[tab]}
                        height="420px"
                        extensions={[htmlLang()]}
                        onChange={(v) => setDrafts((d) => ({ ...d, [tab]: v }))}
                        basicSetup={{ foldGutter: false, highlightActiveLine: false }}
                        aria-label={`${tabLabel[tab]} template`}
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
          <div className="panel-body row save-bar">
            <input type="text" placeholder="What changed? (optional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: '1 1 200px' }} aria-label="Version note" />
            <button className="btn ghost" disabled={!anyDirty || saving} onClick={discard}>
              Discard
            </button>
            <button className="btn primary" disabled={!anyDirty || saving || !!preview.error} onClick={save} title={preview.error ? 'Fix the error shown in the preview first' : undefined}>
              {saving ? 'Saving…' : 'Save version'}
            </button>
          </div>
        </section>

        <div className="sticky stack">
          <Field label="Preview as">
            <select value={as} onChange={(e) => setAs(e.target.value)}>
              <option value="">Sample person (all fields filled)</option>
              {(users.data ?? []).map((u) => (
                <option key={u.upn} value={u.upn}>
                  {u.displayName ?? u.upn}
                  {u.company !== active.company.key ? ` (normally ${u.companyName})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <LetterPreview html={preview.data ?? null} error={preview.error?.message} loading={preview.loading} type={previewType} onTypeChange={setPreviewType} />
          <p className="xs muted">
            {activeDesign?.name}: new v{activeDesign?.new?.version ?? '–'}, reply v{activeDesign?.reply?.version ?? '–'} · brand v{active.meta?.version ?? '–'}
            {activeDesign?.new && <> · last saved {timeAgo([activeDesign.new, activeDesign.reply, active.meta].filter(Boolean).map((t) => t!.createdAt).sort().pop())}</>}
          </p>
        </div>
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
function BrandForm({ company, metaText, meta, onChange }: { company: Company; metaText: string; meta: any; onChange: (text: string) => void }) {
  const toast = useToast();
  const [raw, setRaw] = useState(false);
  const assets = useAsync(() => api.get<{ name: string; localUrl: string }[]>(`/api/admin/assets/${company.key}`), [company.key]);

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
  const banner = meta.banner ?? null;
  const all = assets.data ?? [];
  const banners = all.filter((a) => a.name.startsWith('banner-'));
  const logos = all.filter((a) => !a.name.startsWith('banner-'));

  /** Uploads an image; banners get a "banner-" prefix so they're listed separately. */
  async function upload(file: File, kind: 'logo' | 'banner') {
    if (file.size > 650_000) return toast('Keep images under 650 KB. Export logos at 2× size as PNG, banners at 600px wide.', 'error');
    let name = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+/, '');
    if (kind === 'banner' && !name.startsWith('banner-')) name = `banner-${name}`;
    const dataBase64 = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.readAsDataURL(file);
    });
    try {
      await api.post(`/api/admin/assets/${company.key}`, { name, dataBase64 });
      const img = new Image();
      img.onload = () =>
        patch((m) => {
          if (kind === 'logo') {
            // Assume a 2× export; the signature shows it at half its pixel size.
            m.logo = { ...logo, file: name, width: Math.round(img.naturalWidth / 2), height: Math.round(img.naturalHeight / 2) };
          } else {
            const w = Math.min(600, img.naturalWidth);
            m.banner = { ...(banner ?? {}), file: name, width: w, height: Math.round((img.naturalHeight * w) / img.naturalWidth) };
          }
        });
      img.src = URL.createObjectURL(file);
      await assets.reload();
      toast(kind === 'logo' ? 'Logo uploaded' : 'Banner uploaded');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const pickBanner = (a: { name: string; localUrl: string }) => {
    const img = new Image();
    img.onload = () =>
      patch((m) => {
        const w = Math.min(600, img.naturalWidth);
        m.banner = { ...(banner ?? {}), file: a.name, width: w, height: Math.round((img.naturalHeight * w) / img.naturalWidth) };
      });
    img.src = a.localUrl;
  };

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
            <input type="file" accept="image/png,image/jpeg,image/gif" className="visually-hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'logo')} />
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
              ['title', 'Job title', 'Latvian job title'],
              ['muted', 'Secondary text', 'English title and the confidentiality notice'],
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
        <h3>Text</h3>
        <Field label="Closing line" hint='Shown above the signature, e.g. "Ar cieņu,". Leave empty to leave it out.'>
          <input type="text" value={meta.greeting ?? ''} onChange={(e) => patch((m) => (m.greeting = e.target.value))} />
        </Field>
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

      <section className="stack">
        <h3>Promo banner</h3>
        <p className="xs muted">Shown under new-message signatures only, never in replies. Keep it 600px wide or less.</p>
        <div className="logo-pick" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
          <button type="button" aria-pressed={!banner} onClick={() => patch((m) => (m.banner = null))}>
            <span style={{ height: 36, display: 'grid', placeItems: 'center' }}>None</span>
            No banner
          </button>
          {banners.map((a) => (
            <button key={a.name} type="button" aria-pressed={banner?.file === a.name} onClick={() => pickBanner(a)} title={a.name}>
              <img src={a.localUrl} alt="" />
              {a.name.replace(/^banner-/, '').slice(0, 28)}
            </button>
          ))}
          <label className="btn" style={{ height: 'auto', minHeight: 72, flexDirection: 'column' }}>
            <Upload size={16} /> Upload banner
            <input type="file" accept="image/png,image/jpeg,image/gif" className="visually-hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'banner')} />
          </label>
        </div>
        {banner && (
          <div className="grid-2">
            <Field label="Link when clicked" hint="Optional, must start with https://">
              <input type="url" value={banner.link ?? ''} onChange={(e) => patch((m) => (m.banner = { ...banner, link: e.target.value }))} />
            </Field>
            <Field label="Description" hint="Read out by screen readers and shown when images are blocked">
              <input type="text" value={banner.alt ?? ''} onChange={(e) => patch((m) => (m.banner = { ...banner, alt: e.target.value }))} />
            </Field>
            <Field label="Shown width (px)">
              <input
                type="number"
                min={50}
                max={600}
                value={banner.width}
                onChange={(e) => {
                  const w = Number(e.target.value);
                  patch((m) => (m.banner = { ...banner, width: w, height: Math.round((banner.height * w) / banner.width) }));
                }}
              />
            </Field>
          </div>
        )}
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
  const label: Record<TemplateKind, string> = { new: 'New message', reply: 'Reply', meta: 'Brand (company)', image: 'Image (SVG)', wording: 'Wording' };
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
