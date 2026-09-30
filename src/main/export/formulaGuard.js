/**
 * CSV / spreadsheet formula injection guard (OWASP "CSV injection"). Captions, comments and usernames come from third
 * parties; a text cell starting with = + - @ TAB or CR can be evaluated as a formula by Excel / LibreOffice / Sheets.
 * Such strings get a leading apostrophe so they are shown as text. Only strings are touched: numbers stay numeric.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeFormula(value) {
  return typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : value;
}
