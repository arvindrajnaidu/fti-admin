/**
 * Convert arbitrary-case user-entered names to a consistent Title Case.
 * "zhandra sharief" -> "Zhandra Sharief"
 * "ANIL JAIN"       -> "Anil Jain"
 * "anil-jain"       -> "Anil-Jain"
 * "o'brien"         -> "O'Brien"
 * "mcdonald"        -> "Mcdonald"  (we don't do McCase; simple is fine)
 *
 * Safe for empty / null / non-string input — returns the original value.
 */
export function toTitleCase(value) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (str.length === 0) return str;
  return str.replace(/([\p{L}\p{N}]+)/gu, (word) => {
    const lower = word.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}
