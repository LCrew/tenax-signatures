// Generates templates/<company>/{new.hbs,reply.hbs,meta.json} as visual (block) designs based on the current
// Outlook signatures (Tenax, Tenapors, Tenax Panel, Tenax Install). The .hbs files are compiled by the same
// compiler the admin console uses, so they open in the visual designer.
//
// Usage (from /api):  npx tsx scripts/seed-templates.ts
// On a running server afterwards: Designs › Reload from disk.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { blockDocSchema, compileBlocks, presetDoc, type Block, type BlockDoc } from '../src/services/blocks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ADDRESS = 'Spodrības iela 1, Dobele, LV-3701, Latvija';

interface CompanySeed {
  key: string;
  style: 'side' | 'panel';
  logo: { file: string; width: number; height: number };
  colors: Record<string, string>;
  websites: { label: string; url: string }[];
  companyLine: string;
}

const NAVY = { primary: '#002060', text: '#002060', name: '#002060', title: '#002060', muted: '#2F5496', rule: '#D9D9D9' };
const companies: CompanySeed[] = [
  { key: 'tenax', style: 'side', logo: { file: 'logo.png', width: 183, height: 86 }, colors: NAVY,
    websites: [{ label: 'www.tenaxpanel.lv', url: 'https://tenaxpanel.lv' }, { label: 'www.tenapors.lv', url: 'https://tenapors.lv' }],
    companyLine: 'Sabiedrība ar ierobežotu atbildību “TENAX”' },
  { key: 'tenapors', style: 'side', logo: { file: 'logo.png', width: 120, height: 60 }, colors: NAVY,
    websites: [{ label: 'www.tenapors.lv', url: 'https://www.tenapors.lv' }], companyLine: 'SIA “TENAPORS”' },
  { key: 'tenaxpanel', style: 'panel', logo: { file: 'logo.png', width: 210, height: 142 }, colors: { ...NAVY, title: '#003366' },
    websites: [{ label: 'www.tenaxpanel.com', url: 'https://www.tenaxpanel.com/' }], companyLine: 'TENAX PANEL SIA, TENAX grupa' },
  { key: 'tenaxinstall', style: 'panel', logo: { file: 'logo.png', width: 191, height: 142 }, colors: { ...NAVY, name: '#44546A', title: '#003366' },
    websites: [{ label: 'www.tenaxinstall.com', url: 'https://www.tenaxinstall.com/' }], companyLine: 'TENAX INSTALL SIA, TENAX grupa' },
  // No current signature was provided for Vareno: Tenax layout with a placeholder logo.
  { key: 'vareno', style: 'side', logo: { file: 'logo.png', width: 120, height: 40 }, colors: NAVY,
    websites: [{ label: 'www.tenaxgrupa.lv', url: 'https://www.tenaxgrupa.lv' }], companyLine: 'SIA “Vareno Group”' },
];

const main = (titleSize: number): Block[] => [
  { id: 'name', type: 'name', style: { size: 12, bold: true, color: 'name' } },
  { id: 'jobTitleLv', type: 'jobTitleLv', style: { size: titleSize, color: 'title' } },
  { id: 'jobTitleEn', type: 'jobTitleEn', style: { size: 10, color: 'muted' } },
  { id: 'spacer', type: 'spacer', height: 6 },
  { id: 'mobile', type: 'mobile', label: 'M:', style: {} },
  { id: 'officePhone', type: 'officePhone', label: 'T:', style: {} },
  { id: 'email', type: 'email', style: { color: 'primary' } },
  { id: 'websites', type: 'websites', arrangement: 'stack', separator: ' | ', style: { color: 'primary' } },
  { id: 'companyLine', type: 'companyLine', style: {} },
  { id: 'registration', type: 'registration', label: 'Reģ. nr.', style: {} },
  { id: 'address', type: 'address', style: {} },
];

function newDoc(c: CompanySeed): BlockDoc {
  const panel = c.style === 'panel';
  return blockDocSchema.parse({
    version: 1,
    layout: 'side',
    logo: { valign: panel ? 'top' : 'middle', gap: panel ? 12 : 10 },
    divider: { show: !panel, color: 'primary', thickness: 1 },
    base: { font: 'calibri', size: panel ? 9 : 10, lineHeight: panel ? 1.55 : 1.3, color: 'text' },
    maxWidth: 500,
    greeting: { show: true, style: { size: 11, spaceAfter: 12 } },
    main: main(11),
    footer: [
      { id: 'banner', type: 'banner', spaceAfter: 10 },
      { id: 'confidential', type: 'confidential', style: { size: 7, italic: true, color: 'muted' } },
    ],
  });
}

function placeholderPng(w: number, h: number, [r, g, b]: number[]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const c of companies) {
  const dir = path.join(root, 'templates', c.key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'new.hbs'), compileBlocks(newDoc(c), 'new'));
  fs.writeFileSync(path.join(dir, 'reply.hbs'), compileBlocks(presetDoc('reply'), 'reply'));
  const meta = {
    version: 3,
    logo: c.logo,
    colors: c.colors,
    greeting: '',
    websites: c.websites,
    footer: { companyLine: c.companyLine, registrationNumber: '', address: ADDRESS, confidential: '' },
    banner: null,
  };
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  const logo = path.join(root, 'assets', c.key, c.logo.file);
  if (!fs.existsSync(logo)) {
    fs.mkdirSync(path.dirname(logo), { recursive: true });
    fs.writeFileSync(logo, placeholderPng(c.logo.width * 2, c.logo.height * 2, [0x00, 0x20, 0x60]));
  }
}
console.log(`Wrote block designs for ${companies.map((c) => c.key).join(', ')}`);
