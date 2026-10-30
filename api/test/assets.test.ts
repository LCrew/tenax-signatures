import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageSize, keepBannerProportions } from '../src/services/assets.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, 'assets', rel));

describe('image sizes', () => {
  it('reads PNG, GIF and JPEG (JFIF and Exif) headers', () => {
    expect(imageSize(read('vareno/logo.png'))).toEqual({ width: 240, height: 80 });
    expect(imageSize(read('tenaxpanel/banner-zalaki-un-efektivaki.gif'))).toEqual({ width: 680, height: 106 });
    expect(imageSize(read('tenapors/banner-tenaporscompact.jpg'))).toEqual({ width: 800, height: 450 });
    expect(imageSize(read('tenapors/banner-lt-tenapors-e-pasta-banneris-dp-akcija-lt.jpg'))).toEqual({ width: 800, height: 450 });
    expect(imageSize(read('tenaxpanel/banner-trp-email-lv-1.jpg'))).toEqual({ width: 1200, height: 400 });
  });

  it('gives up on anything else', () => {
    expect(imageSize(Buffer.from('<svg/>'))).toBeNull();
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });
});

describe('banners keep their proportions', () => {
  const sizeOf = (company: string, file: string) => (company === 'vareno' && file === 'banner-promo.png' ? { width: 1200, height: 400 } : null);
  const fit = (html: string) => keepBannerProportions(html, 'https://sig.tenax.lv/', sizeOf);

  it('works out the height from the width and the picture', () => {
    const img = (w: number, h: number) => `<img src="https://sig.tenax.lv/assets/vareno/banner-promo.png" width="${w}" height="${h}" alt="" style="width:${w}px;max-width:100%;height:auto;">`;
    expect(fit(img(550, 220))).toBe(img(550, 183));
    expect(fit(`<p>x</p>${img(600, 1)}<a>${img(500, 999)}</a>`)).toBe(`<p>x</p>${img(600, 200)}<a>${img(500, 167)}</a>`);
  });

  it('leaves logos, other sites and unknown files alone', () => {
    for (const html of [
      '<img src="https://sig.tenax.lv/assets/vareno/logo.png" width="120" height="99">',
      '<img src="https://example.com/assets/vareno/banner-promo.png" width="550" height="220">',
      '<img src="https://sig.tenax.lv/assets/vareno/banner-gone.png" width="550" height="220">',
      '<img src="https://sig.tenax.lv/assets/vareno/banner-promo.png" height="220">',
    ]) {
      expect(fit(html)).toBe(html);
    }
  });
});
