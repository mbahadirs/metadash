import { graphGet, graphGetAll } from './client.js';

const STATUS = { 1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 8: 'PENDING_SETTLEMENT', 9: 'IN_GRACE_PERIOD', 100: 'PENDING_CLOSURE', 101: 'CLOSED', 201: 'ANY_ACTIVE', 202: 'ANY_CLOSED' };

export async function discoverAdAccounts(token) {
  const items = await graphGetAll('/me/adaccounts', { fields: 'id,account_id,name,currency,account_status,business{id,name}', limit: 100 }, { token });
  return items.map((a) => ({
    actId: a.id,
    accountId: a.account_id,
    name: a.name,
    currency: a.currency,
    status: STATUS[a.account_status] ?? String(a.account_status),
    business: a.business ? { id: a.business.id, name: a.business.name } : null,
  }));
}

const RESULT_PRIORITY = ['purchase', 'omni_purchase', 'lead', 'onsite_conversion.messaging_conversation_started_7d', 'link_click', 'landing_page_view', 'post_engagement', 'video_view', 'page_engagement'];

function pickResult(actions = [], costs = []) {
  for (const type of RESULT_PRIORITY) {
    const a = actions.find((x) => x.action_type === type);
    if (a) {
      const c = costs.find((x) => x.action_type === type);
      return { results: Number(a.value), costPerResult: c ? Number(c.value) : null, resultType: type };
    }
  }
  return { results: null, costPerResult: null, resultType: null };
}

export async function fetchAdInsights(actId, token, { since, until, level = 'account', breakdowns = null }) {
  const params = {
    fields: 'spend,impressions,reach,frequency,clicks,ctr,cpc,cpm,actions,cost_per_action_type,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name',
    level,
    time_range: { since, until },
    time_increment: 1,
    limit: 200,
  };
  if (breakdowns) params.breakdowns = breakdowns;
  const rows = await graphGetAll(`/${actId}/insights`, params, { token });
  const act = (actions, type) => { const a = (actions ?? []).find((x) => x.action_type === type); return a ? Number(a.value) : null; };
  return rows.map((r) => {
    const { results, costPerResult, resultType } = pickResult(r.actions, r.cost_per_action_type);
    const objectId = level === 'campaign' ? r.campaign_id : level === 'adset' ? r.adset_id : level === 'ad' ? r.ad_id : actId;
    const objectName = level === 'campaign' ? r.campaign_name : level === 'adset' ? r.adset_name : level === 'ad' ? r.ad_name : null;
    const parentId = level === 'campaign' ? actId : level === 'adset' ? r.campaign_id : level === 'ad' ? r.adset_id : null;
    return {
      actId, date: r.date_start, level, objectId, objectName, parentId,
      spend: Number(r.spend ?? 0), impressions: Number(r.impressions ?? 0), reach: Number(r.reach ?? 0),
      frequency: r.frequency != null ? Number(r.frequency) : null, clicks: Number(r.clicks ?? 0),
      ctr: r.ctr != null ? Number(r.ctr) : null, cpc: r.cpc != null ? Number(r.cpc) : null, cpm: r.cpm != null ? Number(r.cpm) : null,
      results, costPerResult, resultType,
      postEngagement: act(r.actions, 'post_engagement'), pageEngagement: act(r.actions, 'page_engagement'), linkClicks: act(r.actions, 'link_click'),
      breakdownBucket: breakdowns ? breakdowns.split(',').map((b) => r[b]).join('.') : null,
    };
  });
}

export async function fetchAdAccountMeta(actId, token) {
  return graphGet(`/${actId}`, { fields: 'id,name,currency,account_status' }, { token });
}

/**
 * Ads → promoted post links (one paginated call per ad account). The Instagram media id wins; otherwise the
 * Facebook post behind the ad (effective_object_story_id = 'pageid_postid', the same key Facebook Page media use).
 */
export async function fetchAdMediaLinks(actId, token) {
  const rows = await graphGetAll(`/${actId}/ads`, { fields: 'id,name,creative{effective_instagram_media_id,instagram_permalink_url,effective_object_story_id}', limit: 200 }, { token });
  return rows
    .map((r) => ({ r, mediaId: r.creative?.effective_instagram_media_id ?? r.creative?.effective_object_story_id ?? null }))
    .filter(({ mediaId }) => mediaId)
    .map(({ r, mediaId }) => ({
      actId, adId: r.id, adName: r.name, mediaId,
      permalink: r.creative.effective_instagram_media_id ? (r.creative.instagram_permalink_url ?? null) : null,
    }));
}
