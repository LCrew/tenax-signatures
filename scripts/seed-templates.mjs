// Generates templates/<company>/{new.hbs,reply.hbs,meta.json} from the current Outlook signatures
// (deploy/2x_*_paraksti/placeholder.htm), rewritten as email-safe HTML: tables + inline styles only
// (<style> blocks are stripped by Outlook on the web, mobile and many recipients), absolute image URLs,
// every field optional.
//
// Usage: node scripts/seed-templates.mjs   (overwrites templates/*; logos/banners live in assets/<company>/)
// After changing the files on a running server: Designs › Reload from disk.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const FONT = 'Calibri, Arial, Helvetica, sans-serif';
const ADDRESS = 'Spodrības iela 1, Dobele, LV-3701, Latvija';

// Values taken from the current signatures. greeting (%regards%) and confidential (%confidential%) were
// placeholders filled by the old tool; enter the real text in Designs › Brand and footer.
const companies = [
  {
    key: 'tenax',
    layout: 'side',
    logo: { file: 'logo.png', width: 183, height: 86 },
    colors: { primary: '#002060', text: '#002060', name: '#002060', title: '#002060', muted: '#2F5496' },
    websites: [
      { label: 'www.tenaxpanel.lv', url: 'https://tenaxpanel.lv' },
      { label: 'www.tenapors.lv', url: 'https://tenapors.lv' },
    ],
    companyLine: 'Sabiedrība ar ierobežotu atbildību “TENAX”',
  },
  {
    key: 'tenapors',
    layout: 'side',
    logo: { file: 'logo.png', width: 120, height: 60 },
    colors: { primary: '#002060', text: '#002060', name: '#002060', title: '#002060', muted: '#2F5496' },
    websites: [{ label: 'www.tenapors.lv', url: 'https://www.tenapors.lv' }],
    companyLine: 'SIA “TENAPORS”',
  },
  {
    key: 'tenaxpanel',
    layout: 'stacked',
    logo: { file: 'logo.png', width: 210, height: 142 },
    colors: { primary: '#002060', text: '#002060', name: '#002060', title: '#003366', muted: '#2F5496' },
    websites: [{ label: 'www.tenaxpanel.com', url: 'https://www.tenaxpanel.com/' }],
    companyLine: 'TENAX PANEL SIA, TENAX grupa',
  },
  {
    key: 'tenaxinstall',
    layout: 'stacked',
    logo: { file: 'logo.png', width: 191, height: 142 },
    colors: { primary: '#002060', text: '#002060', name: '#44546A', title: '#003366', muted: '#2F5496' },
    websites: [{ label: 'www.tenaxinstall.com', url: 'https://www.tenaxinstall.com/' }],
    companyLine: 'TENAX INSTALL SIA, TENAX grupa',
  },
  {
    // No current signature was provided for Vareno: same layout as Tenax, placeholder logo.
    key: 'vareno',
    layout: 'side',
    logo: { file: 'logo.png', width: 120, height: 40 },
    colors: { primary: '#002060', text: '#002060', name: '#002060', title: '#002060', muted: '#2F5496' },
    websites: [{ label: 'www.tenaxgrupa.lv', url: 'https://www.tenaxgrupa.lv' }],
    companyLine: 'SIA “Vareno Group”',
  },
];

const link = (color) => `color:${color};text-decoration:none;`;

// Shared pieces ─────────────────────────────────────────────────────────────────────────────
const GREETING = `{{#if meta.greeting}}<p style="margin:0 0 12px 0;font-family:${FONT};font-size:11pt;color:{{meta.colors.text}};">{{meta.greeting}}</p>{{/if}}`;

const CONTACT_LINES = (size) => `{{#if user.mobilePhone}}M: <a href="tel:{{tel user.mobilePhone}}" style="${link('{{meta.colors.text}}')}">{{user.mobilePhone}}</a><br>{{/if}}
            {{#if user.officePhone}}T: <a href="tel:{{tel user.officePhone}}" style="${link('{{meta.colors.text}}')}">{{user.officePhone}}</a><br>{{/if}}
            {{#if user.email}}<a href="mailto:{{user.email}}" style="${link('{{meta.colors.primary}}')}">{{user.email}}</a><br>{{/if}}
            {{#each meta.websites}}<a href="{{url}}" style="${link('{{@root.meta.colors.primary}}')}">{{label}}</a><br>{{/each}}
            {{#if meta.footer.companyLine}}<span style="font-size:${size};">{{meta.footer.companyLine}}</span><br>{{/if}}
            {{#if meta.footer.registrationNumber}}<span style="font-size:${size};">Reģ. nr. {{meta.footer.registrationNumber}}</span><br>{{/if}}
            {{#if meta.footer.address}}<span style="font-size:${size};">{{meta.footer.address}}</span>{{/if}}`;

const BANNER = `{{#if meta.bannerUrl}}
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin-top:10px;">
  <tr>
    <td style="padding:10px 0 0 0;">{{#if meta.banner.link}}<a href="{{meta.banner.link}}" style="text-decoration:none;">{{/if}}<img src="{{meta.bannerUrl}}" width="{{meta.banner.width}}" height="{{meta.banner.height}}" alt="{{meta.banner.alt}}" style="display:block;border:0;width:{{meta.banner.width}}px;max-width:100%;height:auto;">{{#if meta.banner.link}}</a>{{/if}}</td>
  </tr>
</table>
{{/if}}`;

const CONFIDENTIAL = `{{#if meta.footer.confidential}}
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;width:100%;max-width:600px;margin-top:10px;">
  <tr>
    <td style="padding:5px;font-family:${FONT};font-size:7pt;line-height:9pt;font-style:italic;color:{{meta.colors.muted}};text-align:justify;">{{meta.footer.confidential}}</td>
  </tr>
</table>
{{/if}}`;

const LOGO = `<img src="{{meta.logoUrl}}" width="{{meta.logoWidth}}" height="{{meta.logoHeight}}" alt="{{meta.logoAlt}}" style="display:block;border:0;width:{{meta.logoWidth}}px;height:{{meta.logoHeight}}px;">`;

// Tenax / Tenapors: logo left, vertical rule, details vertically centred, 10pt ────────────────
const SIDE = `<!-- signature:{{company.key}}:new -->
${GREETING}
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;max-width:500px;font-family:${FONT};color:{{meta.colors.text}};">
  <tr>
    <td style="padding:1px 10px 1px 1px;vertical-align:middle;">${LOGO}</td>
    <td style="padding:1px 1px 1px 10px;vertical-align:middle;border-left:1px solid {{meta.colors.primary}};font-size:10pt;line-height:13pt;color:{{meta.colors.text}};">
            <span style="font-size:12pt;line-height:15pt;font-weight:bold;color:{{meta.colors.name}};">{{user.displayName}}</span><br>
            {{#if user.jobTitleLv}}<span style="font-size:11pt;color:{{meta.colors.title}};">{{user.jobTitleLv}}</span><br>{{/if}}
            {{#if user.jobTitleEn}}<span style="font-size:10pt;color:{{meta.colors.muted}};">{{user.jobTitleEn}}</span><br>{{/if}}
            <span style="display:block;height:6px;line-height:6px;font-size:1px;">&nbsp;</span>
            ${CONTACT_LINES('10pt')}
    </td>
  </tr>
</table>
${BANNER}
${CONFIDENTIAL}
`;

// Tenax Panel / Tenax Install: logo top-left, details top-aligned with airy spacing, 9pt ───────
const STACKED = `<!-- signature:{{company.key}}:new -->
${GREETING}
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;max-width:500px;font-family:${FONT};color:{{meta.colors.text}};">
  <tr>
    <td style="padding:0 12px 0 0;vertical-align:top;">${LOGO}</td>
    <td style="padding:0;vertical-align:top;font-size:9pt;line-height:14pt;color:{{meta.colors.text}};">
            <span style="font-size:12pt;line-height:16pt;font-weight:bold;color:{{meta.colors.name}};">{{user.displayName}}</span><br>
            {{#if user.jobTitleLv}}<span style="font-size:11pt;line-height:15pt;color:{{meta.colors.title}};">{{user.jobTitleLv}}</span><br>{{/if}}
            {{#if user.jobTitleEn}}<span style="font-size:10pt;color:{{meta.colors.muted}};">{{user.jobTitleEn}}</span><br>{{/if}}
            <span style="display:block;height:6px;line-height:6px;font-size:1px;">&nbsp;</span>
            ${CONTACT_LINES('9pt')}
    </td>
  </tr>
</table>
${BANNER}
${CONFIDENTIAL}
`;

// Replies and forwards: compact, no logo or banner ──────────────────────────────────────────
const REPLY = `<!-- signature:{{company.key}}:reply -->
${GREETING}
<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;max-width:500px;font-family:${FONT};font-size:10pt;line-height:13pt;color:{{meta.colors.text}};">
  <tr>
    <td style="padding:0 0 0 8px;border-left:2px solid {{meta.colors.primary}};">
      <span style="font-weight:bold;color:{{meta.colors.name}};">{{user.displayName}}</span>{{#if user.jobTitleLv}} <span style="color:{{meta.colors.muted}};">| {{user.jobTitleLv}}</span>{{/if}}<br>
      {{#if meta.footer.companyLine}}{{meta.footer.companyLine}}{{else}}{{company.displayName}}{{/if}}{{#if user.mobilePhone}} <span style="color:{{meta.colors.muted}};">| M:</span> <a href="tel:{{tel user.mobilePhone}}" style="${link('{{meta.colors.text}}')}">{{user.mobilePhone}}</a>{{/if}}<br>
      {{#if user.email}}<a href="mailto:{{user.email}}" style="${link('{{meta.colors.primary}}')}">{{user.email}}</a>{{/if}}
    </td>
  </tr>
</table>
`;

// Placeholder logo only for companies without one (Vareno).
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function placeholderPng(w, h, [r, g, b]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const c of companies) {
  const dir = path.join(root, 'templates', c.key);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'new.hbs'), c.layout === 'side' ? SIDE : STACKED);
  fs.writeFileSync(path.join(dir, 'reply.hbs'), REPLY);
  const meta = {
    version: 2,
    logo: c.logo,
    colors: { ...c.colors, rule: '#D9D9D9' },
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
console.log(`Wrote templates for ${companies.map((c) => c.key).join(', ')}`);
