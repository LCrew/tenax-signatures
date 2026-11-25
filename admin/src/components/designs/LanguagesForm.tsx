import { useState } from 'react';
import type { Banner, LanguageMeta, PersonLanguage, SignatureLocale, UserSummary } from '../../lib/types';
import { LOCALE_NAMES, STANDARD_GREETINGS } from '../../lib/types';
import { Field, Segmented } from '../ui';
import { type Asset, BannerPicker, bannerName } from './BannerPicker';

export const LOCALES: SignatureLocale[] = ['lv', 'en', 'et', 'lt'];

type BannerState = 'same' | 'none' | 'own';

/** What a language's signature gets: closing line and banner, after falling back to Latvian / the standard wording. */
export function localeSummary(meta: any, locale: SignatureLocale) {
  const own = locale === 'lv' ? null : ((meta?.languages ?? {}) as LanguageMeta)[locale];
  const lvGreeting: string = meta?.greeting ?? '';
  const greeting =
    locale === 'lv'
      ? lvGreeting
      : typeof own?.greeting === 'string' && own.greeting
        ? own.greeting
        : locale === 'en'
          ? lvGreeting
          : lvGreeting
            ? STANDARD_GREETINGS[locale]
            : '';
  const state: BannerState = locale === 'lv' ? (meta?.banner ? 'own' : 'none') : !own || !('banner' in own) ? 'same' : own.banner ? 'own' : 'none';
  const banner: Banner | null = locale === 'lv' || state === 'same' ? (meta?.banner ?? null) : (own?.banner ?? null);
  return { greeting, state, banner };
}

const WHO: Record<SignatureLocale, string> = {
  lv: 'Everyone, unless their person page says otherwise',
  en: 'Everyone on a design set to English only',
  et: 'People set to Estonian on their person page',
  lt: 'People set to Lithuanian on their person page',
};

const WHAT: Record<SignatureLocale, string> = {
  lv: 'The company language. Job titles follow each design’s setting (Latvian, English or both).',
  en: 'English job title only. Company line, address and the rest stay as set in Brand and footer.',
  et: 'Estonian job title with the English one under it, on every design except English-only ones. Company details are the same as in Latvia.',
  lt: 'Lithuanian job title with the English one under it, on every design except English-only ones. Company details are the same as in Latvia.',
};

/**
 * Company › Languages and banners: one card per signature language with its closing line and promo banner.
 * Latvian is the company's own (meta.greeting / meta.banner); the others live in meta.languages.
 */
export function LanguagesForm({
  company,
  companyName,
  meta,
  patch,
  assets,
  onUploaded,
  selected,
  onSelect,
  people,
}: {
  company: string;
  companyName: string;
  meta: any;
  patch: (fn: (m: any) => void) => void;
  assets: Asset[];
  onUploaded: () => void;
  selected: SignatureLocale;
  onSelect: (l: SignatureLocale) => void;
  /** People of this company, to say how many get each language. */
  people: UserSummary[];
}) {
  // "Own banner" chosen but nothing picked yet: show the picker without changing the saved settings.
  const [choosing, setChoosing] = useState<Partial<Record<SignatureLocale, boolean>>>({});
  const languages: LanguageMeta = meta?.languages ?? {};
  const count = (l: SignatureLocale) => (l === 'et' || l === 'lt' ? people.filter((p) => p.language === l).length : l === 'lv' ? people.filter((p) => !p.language).length : null);

  const setLang = (l: 'en' | PersonLanguage, fn: (own: { greeting?: string; banner?: Banner | null }) => void) =>
    patch((m) => {
      const all = { ...(m.languages ?? {}) };
      const own = { ...(all[l] ?? {}) };
      fn(own);
      if (Object.keys(own).length) all[l] = own;
      else delete all[l];
      if (Object.keys(all).length) m.languages = all;
      else delete m.languages;
    });

  const sel = localeSummary(meta, selected);
  const own = selected === 'lv' ? null : languages[selected];
  const bannerState: BannerState = selected !== 'lv' && sel.state === 'same' && choosing[selected] ? 'own' : sel.state;
  const thumb = (file: string | undefined) => assets.find((a) => a.name === file)?.localUrl;

  return (
    <div className="stack loose">
      <p className="small muted">
        Each person’s signature language decides the closing line, the promo banner and which job titles are shown. Set
        Estonian or Lithuanian on the person’s page under People; everyone else is Latvian. Designs only decide whether a
        banner appears (Wording tab), not which one.
      </p>

      <div className="lang-cards" role="tablist" aria-label="Signature language">
        {LOCALES.map((l) => {
          const s = localeSummary(meta, l);
          const n = count(l);
          return (
            <button key={l} type="button" role="tab" aria-selected={selected === l} className="lang-card" onClick={() => onSelect(l)}>
              <span className="lang-card-head">
                <span className="lang-code">{l.toUpperCase()}</span>
                <strong>{LOCALE_NAMES[l]}</strong>
                {n !== null && <span className="xs muted">{n === 1 ? '1 person' : `${n} people`}</span>}
              </span>
              <span className="lang-card-greeting">{s.greeting ? `“${s.greeting}”` : <span className="muted">No closing line</span>}</span>
              <span className="lang-card-banner">
                {s.banner && thumb(s.banner.file) ? <img src={thumb(s.banner.file)} alt="" /> : <span className="muted">No banner</span>}
              </span>
              {l !== 'lv' && s.state === 'same' && <span className="xs muted">Banner: same as Latvian</span>}
            </button>
          );
        })}
      </div>

      <section className="panel-inset stack" role="tabpanel" aria-label={`${LOCALE_NAMES[selected]} signature`}>
        <div className="stack tight">
          <h3>{LOCALE_NAMES[selected]} signature</h3>
          <p className="small muted">
            <strong>Who:</strong> {WHO[selected]}. {WHAT[selected]}
          </p>
        </div>

        {selected === 'lv' ? (
          <Field label="Closing line" hint='Shown above the signature, e.g. "Ar cieņu,". Leave empty to leave it out.'>
            <input type="text" value={meta?.greeting ?? ''} maxLength={200} onChange={(e) => patch((m) => (m.greeting = e.target.value))} />
          </Field>
        ) : (
          <Field
            label="Closing line"
            hint={
              selected === 'en'
                ? `Empty = the Latvian one${meta?.greeting ? ` (“${meta.greeting}”)` : ''}.`
                : meta?.greeting
                  ? `Empty = the standard “${STANDARD_GREETINGS[selected]}”.`
                  : 'Empty = none, like the Latvian signature.'
            }
          >
            <input
              type="text"
              value={own?.greeting ?? ''}
              maxLength={200}
              placeholder={selected === 'en' ? 'e.g. Best regards,' : STANDARD_GREETINGS[selected]}
              onChange={(e) =>
                setLang(selected, (o) => {
                  if (e.target.value) o.greeting = e.target.value;
                  else delete o.greeting;
                })
              }
            />
          </Field>
        )}

        <div className="stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong className="small">Promo banner</strong>
            {selected !== 'lv' && (
              <Segmented<BannerState>
                label={`${LOCALE_NAMES[selected]} banner`}
                value={bannerState}
                options={[
                  { value: 'same', label: 'Same as Latvian' },
                  { value: 'own', label: `Own ${LOCALE_NAMES[selected]} banner` },
                  { value: 'none', label: 'No banner' },
                ]}
                onChange={(v) => {
                  const l = selected as 'en' | PersonLanguage;
                  setChoosing((c) => ({ ...c, [l]: v === 'own' }));
                  if (v === 'same') setLang(l, (o) => delete o.banner);
                  if (v === 'none') setLang(l, (o) => (o.banner = null));
                  if (v === 'own' && sel.state === 'none') setLang(l, (o) => delete o.banner);
                }}
              />
            )}
          </div>
          <p className="xs muted">
            Under new-message signatures only, never in replies. Bigger images are scaled down to 1200px wide (shown at up to
            600px) and kept under 1 MB.
          </p>
          {selected === 'lv' ? (
            <BannerPicker company={company} assets={assets} onUploaded={onUploaded} value={meta?.banner ?? null} onChange={(b) => patch((m) => (m.banner = b))} />
          ) : bannerState === 'own' ? (
            <BannerPicker
              company={company}
              assets={assets}
              onUploaded={onUploaded}
              allowNone={false}
              value={own?.banner ?? null}
              onChange={(b) => setLang(selected, (o) => (o.banner = b))}
            />
          ) : bannerState === 'same' ? (
            <p className="small">
              {meta?.banner ? <>Uses the Latvian banner, {bannerName(meta.banner.file)}.</> : <>The Latvian signature has no banner, so neither does this one.</>}
            </p>
          ) : (
            <p className="small">No banner for {LOCALE_NAMES[selected]} signatures at {companyName}.</p>
          )}
        </div>
      </section>
    </div>
  );
}
