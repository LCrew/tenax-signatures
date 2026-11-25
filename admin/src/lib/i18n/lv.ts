import { blocks } from './lv/blocks';
import { common } from './lv/common';
import { designs } from './lv/designs';
import { people } from './lv/people';
import { settings } from './lv/settings';
import { shell } from './lv/shell';

/** Latvian dictionary, English text → Latvian. Split by area; `npm run i18n` checks it against the code. */
export const LV: Record<string, string> = { ...common, ...shell, ...people, ...designs, ...blocks, ...settings };
