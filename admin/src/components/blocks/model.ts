// Mirrors api/src/services/blocks.ts (the server validates and compiles; this is only for editing).

export type ColorToken = 'primary' | 'text' | 'name' | 'title' | 'muted' | 'rule';
export type BlockColor = ColorToken | string;

export interface BlockStyle {
  size?: number;
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  color?: BlockColor;
  spaceAfter?: number;
}

export type FieldType = 'name' | 'jobTitleLv' | 'jobTitleEn' | 'department' | 'email' | 'companyLine' | 'address';
export type LabelledType = 'mobile' | 'officePhone' | 'registration';

export type Block =
  | { id: string; hidden?: boolean; type: FieldType; style: BlockStyle }
  | { id: string; hidden?: boolean; type: LabelledType; label: string; style: BlockStyle }
  | { id: string; hidden?: boolean; type: 'websites'; arrangement: 'stack' | 'inline'; separator: string; style: BlockStyle }
  | { id: string; hidden?: boolean; type: 'text'; text: string; style: BlockStyle }
  | { id: string; hidden?: boolean; type: 'spacer'; height: number }
  | { id: string; hidden?: boolean; type: 'divider'; color: BlockColor; thickness: number; spaceAfter: number }
  | { id: string; hidden?: boolean; type: 'banner'; spaceAfter: number }
  | { id: string; hidden?: boolean; type: 'confidential'; style: BlockStyle };
export type BlockType = Block['type'];

export interface BlockDoc {
  version: 1;
  layout: 'side' | 'stacked' | 'textOnly';
  logo: { valign: 'top' | 'middle'; gap: number };
  divider: { show: boolean; color: BlockColor; thickness: number };
  base: { font: FontKey; size: number; lineHeight: number; color: BlockColor };
  maxWidth: number;
  greeting: { show: boolean; style: BlockStyle };
  main: Block[];
  footer: Block[];
}

export const FONTS = {
  calibri: 'Calibri',
  arial: 'Arial',
  helvetica: 'Helvetica',
  verdana: 'Verdana',
  tahoma: 'Tahoma',
  trebuchet: 'Trebuchet MS',
  segoe: 'Segoe UI',
  georgia: 'Georgia (serif)',
  times: 'Times New Roman (serif)',
} as const;
export type FontKey = keyof typeof FONTS;

export const TOKEN_LABELS: Record<ColorToken, string> = {
  primary: 'Brand',
  text: 'Text',
  name: 'Name',
  title: 'Job title',
  muted: 'Secondary',
  rule: 'Lines',
};

/** Same defaults the compiler applies, so the editor shows what a block will really look like. */
export const BLOCK_DEFAULTS: Partial<Record<BlockType, BlockStyle>> = {
  name: { size: 12, bold: true, color: 'name' },
  jobTitleLv: { size: 11, color: 'title' },
  jobTitleEn: { color: 'muted' },
  email: { color: 'primary' },
  websites: { color: 'primary' },
  confidential: { size: 7, italic: true, color: 'muted' },
};

export interface BlockInfo {
  label: string;
  hint: string;
  /** Can appear more than once. */
  repeatable?: boolean;
  /** Where it can go. */
  zones: ('main' | 'footer')[];
  /** Data comes from the person or the brand settings; empty means the line is left out. */
  source?: string;
}

export const BLOCK_INFO: Record<BlockType, BlockInfo> = {
  name: { label: 'Name', hint: 'Full name from the directory', zones: ['main'], source: 'Person' },
  jobTitleLv: { label: 'Job title (LV)', hint: 'Latvian job title', zones: ['main'], source: 'Person' },
  jobTitleEn: { label: 'Job title (EN)', hint: 'English job title, if set', zones: ['main'], source: 'Person' },
  department: { label: 'Department', hint: 'From the directory', zones: ['main'], source: 'Person' },
  mobile: { label: 'Mobile', hint: 'With a label such as "M:"', zones: ['main'], source: 'Person' },
  officePhone: { label: 'Office phone', hint: 'With a label such as "T:"', zones: ['main'], source: 'Person' },
  email: { label: 'Email', hint: 'Clickable email address', zones: ['main'], source: 'Person' },
  websites: { label: 'Websites', hint: 'From Brand and footer', zones: ['main', 'footer'], source: 'Brand' },
  companyLine: { label: 'Company line', hint: 'e.g. SIA “TENAPORS”', zones: ['main', 'footer'], source: 'Brand' },
  registration: { label: 'Registration no.', hint: 'Only shown when set', zones: ['main', 'footer'], source: 'Brand' },
  address: { label: 'Address', hint: 'From Brand and footer', zones: ['main', 'footer'], source: 'Brand' },
  text: { label: 'Text', hint: 'Any fixed text you type', repeatable: true, zones: ['main', 'footer'] },
  spacer: { label: 'Space', hint: 'Empty vertical space', repeatable: true, zones: ['main', 'footer'] },
  divider: { label: 'Line', hint: 'Horizontal line', repeatable: true, zones: ['main', 'footer'] },
  banner: { label: 'Promo banner', hint: 'Chosen in Brand and footer', zones: ['footer'], source: 'Brand' },
  confidential: { label: 'Confidentiality notice', hint: 'Small print from Brand and footer', zones: ['main', 'footer'], source: 'Brand' },
};

export function newBlock(type: BlockType): Block {
  const id = `${type}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  switch (type) {
    case 'mobile':
      return { id, type, label: 'M:', style: {} };
    case 'officePhone':
      return { id, type, label: 'T:', style: {} };
    case 'registration':
      return { id, type, label: 'Reģ. nr.', style: {} };
    case 'websites':
      return { id, type, arrangement: 'stack', separator: ' | ', style: {} };
    case 'text':
      return { id, type, text: '', style: {} };
    case 'spacer':
      return { id, type, height: 8 };
    case 'divider':
      return { id, type, color: 'rule', thickness: 1, spaceAfter: 6 };
    case 'banner':
      return { id, type, spaceAfter: 10 };
    default:
      return { id, type, style: {} } as Block;
  }
}

export function hasStyle(b: Block): b is Extract<Block, { style: BlockStyle }> {
  return 'style' in b;
}

/** Effective style for display (block defaults + overrides). */
export function effectiveStyle(doc: BlockDoc, b: Block): Required<Pick<BlockStyle, 'size'>> & BlockStyle {
  const d = BLOCK_DEFAULTS[b.type] ?? {};
  const s = hasStyle(b) ? b.style : {};
  return { ...d, ...s, size: s.size ?? d.size ?? doc.base.size };
}
