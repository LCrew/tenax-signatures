/** Same rules as api/src/auth/local.ts passwordProblems(). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[^a-zA-Z]/.test(pw)) return 'Mix letters with numbers or symbols.';
  return null;
}
