import { graphGetAll, graphDelay } from '../../meta/client.js';

/**
 * Walks every Facebook Page a Meta user token can see:
 *  1. /me/accounts — Pages where the user has a personal role
 *  2. /me/businesses → owned_pages + client_pages — Pages managed through Business Manager
 * Pages are merged by id (later sightings overwrite fields they carry; `sources` accumulates where each page was seen).
 * Failing endpoints are collected in `warnings` instead of aborting.
 *
 * `onBusiness(business, pages)` runs after each business's page edges (with the pages collected so far), so callers can
 * walk extra business edges in the same order (Instagram uses it for owned/client_instagram_accounts).
 *
 * @param {object} opts
 * @param {string} opts.token          Meta user token
 * @param {string} opts.fields         Graph `fields` for page objects
 * @param {(b:{id:string,name:string}, pages:Map<string,{id:string, page:object, sources:string[]}>)=>Promise<void>} [opts.onBusiness]
 * @param {{ getAll: Function, delay: Function }} [opts.client]  defaults to the shared Meta client
 * @returns {Promise<{ pages: {id:string, page:object, sources:string[]}[], businesses: {id:string,name:string}[], warnings: object[] }>}
 */
export async function discoverMetaPages({ token, fields, onBusiness, client }) {
  const getAll = client?.getAll ?? graphGetAll;
  const delay = client?.delay ?? graphDelay;
  const pages = new Map();
  const warnings = [];
  const addPage = (p, source) => {
    const prev = pages.get(p.id);
    const defined = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
    pages.set(p.id, { id: p.id, page: { ...(prev?.page ?? {}), ...defined }, sources: [...new Set([...(prev?.sources ?? []), source])] });
  };

  try {
    const list = await getAll('/me/accounts', { fields, limit: 100 }, { token });
    for (const p of list) addPage(p, 'me/accounts');
  } catch (e) {
    warnings.push({ endpoint: '/me/accounts', code: e.code ?? null, message: e.message });
  }

  let businesses = [];
  try {
    businesses = await getAll('/me/businesses', { fields: 'id,name', limit: 100 }, { token });
  } catch (e) {
    warnings.push({ endpoint: '/me/businesses', code: e.code ?? null, message: e.message });
  }
  for (const b of businesses) {
    for (const edge of ['owned_pages', 'client_pages']) {
      try {
        const list = await getAll(`/${b.id}/${edge}`, { fields, limit: 100 }, { token });
        for (const p of list) addPage(p, `${b.name} · ${edge}`);
      } catch (e) {
        warnings.push({ endpoint: `/${b.id}/${edge}`, code: e.code ?? null, message: e.message, business: b.name });
      }
      await delay();
    }
    if (onBusiness) {
      const extra = await onBusiness(b, pages);
      if (Array.isArray(extra)) warnings.push(...extra);
    }
  }

  return { pages: [...pages.values()], businesses: businesses.map((b) => ({ id: b.id, name: b.name })), warnings };
}
