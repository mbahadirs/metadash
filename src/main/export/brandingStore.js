import { getConfig, setConfig } from '../config/store.js';
import { resolveBranding, brandingErrors } from './branding.js';
import { msg } from '../i18n.js';

const LOGO_KEY = 'reportBranding.logo';

/** Current report branding from settings, normalised. */
export function loadBranding() {
  return resolveBranding({ ...(getConfig('reportBranding') ?? {}), logo: getConfig(LOGO_KEY) });
}

/** Validates and merges a partial branding update; throws a localized error on invalid colour/logo. */
export function saveBranding(patch) {
  const input = patch && typeof patch === 'object' ? patch : {};
  const errors = brandingErrors(input);
  if (errors.length) throw new Error(msg(errors[0]));
  const next = resolveBranding({ ...loadBranding(), ...input });
  const { logo, ...fields } = next;
  setConfig('reportBranding', fields);
  if ('logo' in input) setConfig(LOGO_KEY, logo);
  return next;
}
