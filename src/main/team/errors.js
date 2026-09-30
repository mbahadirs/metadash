import { msg } from '../i18n.js';

/**
 * Localized team error: code 'TEAM_PIN_WRONG' → message key 'team_pin_wrong' (src/main/locales/<lang>/team.json).
 * The code is kept on the error so the renderer and the CLI can branch on it.
 */
export function teamError(code, vars) {
  return Object.assign(new Error(msg(code.toLowerCase(), vars)), { code });
}
