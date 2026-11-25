import { Upload } from 'lucide-react';
import { api } from '../../lib/api';
import { BANNER_MAX_SHOWN, prepareBanner, resizeBanner } from '../../lib/banner';
import { useAsync, useImageRatio, useToast } from '../../lib/hooks';
import { t } from '../../lib/i18n';
import type { Banner } from '../../lib/types';
import { Field } from '../ui';

export interface Asset {
  name: string;
  localUrl: string;
}

/** The company's uploaded images (logos and banners). */
export function useCompanyAssets(company: string) {
  return useAsync(() => api.get<Asset[]>(`/api/admin/assets/${company}`), [company]);
}

export const bannerName = (file: string) => file.replace(/^banner-/, '');

/** `file` at its natural proportions, shown up to 600px wide; keeps the link and description of `prev`. */
function measured(file: string, url: string, prev: Banner | null): Promise<Banner> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.min(BANNER_MAX_SHOWN, img.naturalWidth);
      resolve({ ...(prev ?? {}), file, width: w, height: Math.max(1, Math.round((img.naturalHeight * w) / img.naturalWidth)) });
    };
    img.onerror = () => reject(new Error(t('This image can’t be read')));
    img.src = url;
  });
}

/** Scales and compresses a banner, uploads it for the company (named banner-…) and returns its saved name. */
export async function uploadBanner(company: string, file: File): Promise<File & { savedAs: string }> {
  const ready = await prepareBanner(file);
  let name = ready.name.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^-+/, '');
  if (!name.startsWith('banner-')) name = `banner-${name}`;
  const dataBase64 = await new Promise<string>((res) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.readAsDataURL(ready);
  });
  await api.post(`/api/admin/assets/${company}`, { name, dataBase64 });
  return Object.assign(ready, { savedAs: name });
}

/**
 * Pick one of the company's banners (or upload one), then set its link, description and shown width.
 * `allowNone` adds a "No banner" choice that sets null.
 */
export function BannerPicker({
  company,
  assets,
  onUploaded,
  value,
  onChange,
  allowNone = true,
  label,
}: {
  company: string;
  assets: Asset[];
  onUploaded: () => void;
  value: Banner | null;
  onChange: (b: Banner | null) => void;
  allowNone?: boolean;
  label?: string;
}) {
  const toast = useToast();
  const banners = assets.filter((a) => a.name.startsWith('banner-'));
  const ratio = useImageRatio(banners.find((a) => a.name === value?.file)?.localUrl);

  const pick = async (a: Asset) => {
    try {
      onChange(await measured(a.name, a.localUrl, value));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const upload = async (file: File) => {
    try {
      const saved = await uploadBanner(company, file);
      const url = URL.createObjectURL(saved);
      onChange(await measured(saved.savedAs, url, value));
      URL.revokeObjectURL(url);
      onUploaded();
      toast(t('Banner uploaded'));
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="stack">
      <div className="banner-grid" role="group" aria-label={label ?? t('Promo banner')}>
        {allowNone && (
          <button type="button" className="banner-tile none" aria-pressed={!value} onClick={() => onChange(null)}>
            <span className="banner-thumb">{t('No banner')}</span>
            <span className="banner-name">{t('None')}</span>
          </button>
        )}
        {banners.map((a) => (
          <button key={a.name} type="button" className="banner-tile" aria-pressed={value?.file === a.name} onClick={() => void pick(a)} title={bannerName(a.name)}>
            <span className="banner-thumb">
              <img src={a.localUrl} alt="" />
            </span>
            <span className="banner-name">{bannerName(a.name)}</span>
          </button>
        ))}
        <label className="banner-tile upload">
          <span className="banner-thumb">
            <Upload size={16} aria-hidden />
          </span>
          <span className="banner-name">{t('Upload banner')}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif"
            className="visually-hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void upload(f);
            }}
          />
        </label>
      </div>
      {value && (
        <div className="grid-3">
          <Field label={t('Link when clicked')} hint={t('Optional, starts with https://')}>
            <input type="url" value={value.link ?? ''} placeholder="https://" onChange={(e) => onChange({ ...value, link: e.target.value })} />
          </Field>
          <Field label={t('Description')} hint={t('Read out by screen readers and shown when images are blocked')}>
            <input type="text" value={value.alt ?? ''} onChange={(e) => onChange({ ...value, alt: e.target.value })} />
          </Field>
          <Field label={t('Shown width (px)')} hint={t('Up to {max}px; the height follows the image', { max: BANNER_MAX_SHOWN })}>
            <input type="number" min={50} max={BANNER_MAX_SHOWN} value={value.width} onChange={(e) => onChange(resizeBanner(value, Number(e.target.value), ratio))} />
          </Field>
        </div>
      )}
    </div>
  );
}
