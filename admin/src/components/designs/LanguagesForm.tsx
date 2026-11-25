import { useState } from 'react';
import type { Banner, LanguageMeta, PersonLanguage, SignatureLocale, UserSummary } from '../../lib/types';
import { LOCALE_NAMES, STANDARD_GREETINGS } from '../../lib/types';
import { msg, t, tn } from '../../lib/i18n';
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
  lv: msg('Everyone, unless their person page says otherwise'),
  en: msg('Everyone on a design set to English only'),
  et: msg('People set to Estonian on their person page'),
  lt: msg('People set to Lithuanian on their person page'),
};

const WHAT: Record<SignatureLocale, string> = {
  lv: msg('The company language. Job titles follow each design’s setting (Latvian, English or both).'),
  en: msg('English job title only. Company line, address and the rest stay as set in Brand and footer.'),
  et: msg('Estonian job title with the English one under it, on every design except English-only ones. Company details are the same as in Latvia.'),
  lt: msg('Lithuanian job title with the English one under it, on every design except English-only ones. Company details are the same as in Latvia.'),
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
        {t('Each person’s signature language decides the closing line, the promo banner and which job titles are shown. Set Estonian or Lithuanian on the person’s page under People; everyone else is Latvian. Designs only decide whether a banner appears (Wording tab), not which one.')}
      </p>

      <div className="lang-cards" role="tablist" aria-label={t('Signature language')}>
        {LOCALES.map((l) => {
          const s = localeSummary(meta, l);
          const n = count(l);
          return (
            <button key={l} type="button" role="tab" aria-selected={selected === l} className="lang-card" onClick={() => onSelect(l)}>
              <span className="lang-card-head">
                <span className="lang-code">{l.toUpperCase()}</span>
                <strong>{t(LOCALE_NAMES[l])}</strong>
                {n !== null && <span className="xs muted">{tn(n, '{n} person', '{n} people')}</span>}
              </span>
              <span className="lang-card-greeting">{s.greeting ? t('“{text}”', { text: s.greeting }) : <span className="muted">{t('No closing line')}</span>}</span>
              <span className="lang-card-banner">
                {s.banner && thumb(s.banner.file) ? <img src={thumb(s.banner.file)} alt="" /> : <span className="muted">{t('No banner')}</span>}
              </span>
              {l !== 'lv' && s.state === 'same' && <span className="xs muted">{t('Banner: same as Latvian')}</span>}
            </button>
          );
        })}
      </div>

      <section className="panel-inset stack" role="tabpanel" aria-label={t('{language} signature', { language: t(LOCALE_NAMES[selected]) })}>
        <div className="stack tight">
          <h3>{t('{language} signature', { language: t(LOCALE_NAMES[selected]) })}</h3>
          <p className="small muted">
            <strong>{t('Who:')}</strong> {t(WHO[selected])}. {t(WHAT[selected])}
          </p>
        </div>

        {selected === 'lv' ? (
          <Field label={t('Closing line')} hint={t('Shown above the signature, e.g. "Ar cieņu,". Leave empty to leave it out.')}>
            <input type="text" value={meta?.greeting ?? ''} maxLength={200} onChange={(e) => patch((m) => (m.greeting = e.target.value))} />
          </Field>
        ) : (
          <Field
            label={t('Closing line')}
            hint={
              selected === 'en'
                ? meta?.greeting
                  ? t('Empty = the Latvian one (“{greeting}”).', { greeting: meta.greeting })
                  : t('Empty = the Latvian one.')
                : meta?.greeting
                  ? t('Empty = the standard “{greeting}”.', { greeting: STANDARD_GREETINGS[selected] })
                  : t('Empty = none, like the Latvian signature.')
            }
          >
            <input
              type="text"
              value={own?.greeting ?? ''}
              maxLength={200}
              placeholder={selected === 'en' ? t('e.g. Best regards,') : STANDARD_GREETINGS[selected]}
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
            <strong className="small">{t('Promo banner')}</strong>
            {selected !== 'lv' && (
              <Segmented<BannerState>
                label={t('{language} banner', { language: t(LOCALE_NAMES[selected]) })}
                value={bannerState}
                options={[
                  { value: 'same', label: t('Same as Latvian') },
                  { value: 'own', label: t('Own {language} banner', { language: t(LOCALE_NAMES[selected]) }) },
                  { value: 'none', label: t('No banner') },
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
            {t('Under new-message signatures only, never in replies. Bigger images are scaled down to 1200px wide (shown at up to 600px) and kept under 1 MB.')}
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
              {meta?.banner ? t('Uses the Latvian banner, {name}.', { name: bannerName(meta.banner.file) }) : t('The Latvian signature has no banner, so neither does this one.')}
            </p>
          ) : (
            <p className="small">{t('No banner for {language} signatures at {company}.', { language: t(LOCALE_NAMES[selected]), company: companyName })}</p>
          )}
        </div>
      </section>
    </div>
  );
}
