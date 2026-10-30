/** Promo banners are shown at most 600px wide; stored at twice that so they stay sharp on high-resolution screens. */
export const BANNER_MAX_SHOWN = 600;
export const BANNER_MAX_STORED = 1200;
/** Same limit as the server (POST /api/admin/assets). */
export const BANNER_MAX_BYTES = 1_000_000;

const MB = (n: number) => `${(n / 1_000_000).toFixed(1)} MB`;

/**
 * Makes a banner ready to upload: scaled down to BANNER_MAX_STORED wide (keeping its proportions) and under 1 MB.
 * A PNG stays a PNG when it fits; otherwise it becomes a JPEG on white. Images that already fit are left untouched,
 * and so are GIFs (redrawing would lose their animation).
 */
export async function prepareBanner(file: File): Promise<File> {
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    if (file.size > BANNER_MAX_BYTES) throw new Error(`This GIF is ${MB(file.size)}. GIF banners can’t be made smaller here: keep them under 1 MB.`);
    return file;
  }
  const img = await load(file);
  const scale = Math.min(1, BANNER_MAX_STORED / img.naturalWidth);
  if (scale === 1 && file.size <= BANNER_MAX_BYTES) return file;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  const stem = file.name.replace(/\.[a-z0-9]+$/i, '');

  if (file.type === 'image/png') {
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await encode(canvas, 'image/png');
    if (png.size <= BANNER_MAX_BYTES) return new File([png], `${stem}.png`, { type: 'image/png' });
    g.clearRect(0, 0, canvas.width, canvas.height);
  }
  // JPEG has no transparency: transparent parts become white, like the email around them.
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.9, 0.82, 0.74, 0.66, 0.58, 0.5]) {
    const jpg = await encode(canvas, 'image/jpeg', quality);
    if (jpg.size <= BANNER_MAX_BYTES) return new File([jpg], `${stem}.jpg`, { type: 'image/jpeg' });
  }
  throw new Error('This banner is still over 1 MB after compressing. Export it smaller and try again.');
}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This image can’t be read. Upload a PNG, JPEG or GIF.'));
    };
    img.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The banner couldn’t be compressed'))), type, quality));
}
