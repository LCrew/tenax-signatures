import crypto from 'node:crypto';

/**
 * Embedded (inline) signature images for the Outlook add-in.
 *
 * Linked images break in replies from Outlook for Mac: when it quotes an email whose web images it didn't download,
 * it swaps each one for an empty "cid:~WRD0000.jpg" ("Image removed by sender") and sends that on. An image attached
 * to the email itself travels into every reply, like a pasted screenshot.
 *
 * Embedded: logos and image signatures. Promo banners (banner-* files, 100–600 KB) stay linked, so not every email
 * carries them.
 */

export interface InlineImage {
  /** Attachment file name, referenced as cid:<name>. Unique per signature, so it never clashes with an image quoted from an earlier email. */
  name: string;
  /** The link it replaced; the add-in goes back to it if attaching fails. */
  url: string;
  base64: string;
}

/** A huge uploaded logo stays linked rather than riding along in every email. */
export const INLINE_MAX_BYTES = 256 * 1024;

export interface ImageSource {
  asset(company: string, file: string): Buffer | null;
  signatureImage(hash: string): Buffer | null;
}

/** Points our own logo / image-signature <img> tags at cid: names and returns the images to attach. */
export function inlineImages(html: string, publicUrl: string, source: ImageSource): { html: string; images: InlineImage[] } {
  const base = publicUrl.replace(/\/+$/, '');
  const tag = crypto.randomBytes(4).toString('hex');
  const byUrl = new Map<string, InlineImage | null>();
  const names = new Set<string>();

  const make = (stem: string, ext: string, url: string, data: Buffer | null): InlineImage | null => {
    if (!data || data.length > INLINE_MAX_BYTES) return null;
    const clean = stem.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60);
    let name = `${clean}-${tag}.${ext}`;
    for (let i = 2; names.has(name); i++) name = `${clean}-${tag}-${i}.${ext}`;
    names.add(name);
    return { name, url, base64: data.toString('base64') };
  };

  const load = (url: string): InlineImage | null => {
    if (!url.startsWith(`${base}/`)) return null;
    const rel = url.slice(base.length);
    const asset = /^\/assets\/([a-z0-9-]+)\/([a-z0-9][a-z0-9._-]*)\.(png|jpe?g|gif)$/i.exec(rel);
    if (asset) {
      const [, company, stem, ext] = asset;
      if (/^banner-/i.test(stem)) return null;
      return make(`${company}-${stem}`, ext.toLowerCase(), url, source.asset(company, `${stem}.${ext}`));
    }
    const sig = /^\/sig-img\/([a-f0-9]{40})\.png$/.exec(rel);
    if (sig) return make('signature', 'png', url, source.signatureImage(sig[1]));
    return null;
  };

  const out = html.replace(/(<img\b[^>]*?\bsrc=)(["'])([^"']*)\2/gi, (whole, pre: string, q: string, url: string) => {
    if (!byUrl.has(url)) byUrl.set(url, load(url));
    const img = byUrl.get(url);
    return img ? `${pre}${q}cid:${img.name}${q}` : whole;
  });
  return { html: out, images: [...byUrl.values()].filter((i): i is InlineImage => i !== null) };
}
