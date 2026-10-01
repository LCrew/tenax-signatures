/**
 * Normalise Latvian numbers to "+371 2X XXX XXX" (8 national digits, grouped 2-3-3).
 * Anything that doesn't look Latvian is returned trimmed and otherwise untouched.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (digits.startsWith('+371')) digits = digits.slice(4);
  else if (digits.startsWith('371') && digits.length === 11) digits = digits.slice(3);
  else if (digits.startsWith('+')) return trimmed; // foreign number, keep as entered
  if (/^[2-9]\d{7}$/.test(digits)) {
    return `+371 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  }
  return trimmed;
}

/** Digits-only form for tel: links. */
export function telHref(phone: string | null | undefined): string {
  if (!phone) return '';
  return phone.replace(/[^\d+]/g, '');
}
