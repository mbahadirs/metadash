import { getDb } from '../../db/index.js';
import { EXCLUDED_TABLES } from './sqlGuard.js';

/** Tables the model never sees: secrets (also blocked by the SQL guard), internals and binary blobs. */
const HIDDEN_TABLES = new Set([
  ...EXCLUDED_TABLES, 'schema_version', 'account_logos', 'sync_runs', 'sync_errors', 'disabled_metrics', 'metric_resolution',
  'planner_quota', // API quota cache (planner_uploads / planner_approval_packs are in EXCLUDED_TABLES)
  // v2.0 internals (chunk B): quota ledger, leases, inbox poll cursors, worker token registry, team event bookkeeping.
  'api_quota', 'locks', 'inbox_cursor', 'worker_tokens', 'team_events_applied', 'mention_seen',
]);
const HIDDEN_COLUMN = /token|secret/i;

/** Hand-written notes on the important tables (units, date formats, join keys, pitfalls). */
const NOTES = {
  accounts: "One row per social account. platform = 'instagram' | 'facebook' (Facebook Page) | 'threads'. ig_id is the account key used by every other table: Instagram numeric id, 'fb-<pageId>' for Facebook, 'th-<userId>' for Threads (external_id = raw API id). linked_account_id = the ig_id of the same brand's Instagram account. Only is_tracked = 1 accounts are shown in the app. client_name = the agency client. first_seen_at/last_synced_at are epoch ms. Always group or filter by platform when comparing metrics: platforms measure differently.",
  account_tags: 'Many-to-many accounts ↔ tags.',
  tags: 'User-defined account groups (e.g. sector, client tier).',
  account_snapshots: "One row per account per day. date = 'YYYY-MM-DD' (local). followers = total followers that day. Growth over a range = followers on the last date minus followers on the first date; growth % = that / first-date followers * 100.",
  account_insights_daily: "Long format: one row per (ig_id, date 'YYYY-MM-DD', metric) with value. Sum daily values over a range (reach sums are an upper bound: unique reach is not additive). follower_count = new followers that day. Metrics by platform: Instagram reach, views, profile_views, accounts_engaged, follower_count; Facebook reach (shown as 'Viewers'), views, post_engagements, profile_views (page views), follower_count, unfollows; Threads views, likes, replies, reposts, quotes, link_clicks (Threads has NO reach — use views).",
  account_demographics: 'Follower demographics captured at captured_at (epoch ms). Instagram: dimension = city | country | gender_age (bucket like F.25-34). Threads: dimension = age | gender (F/M/U) | country | city. value = follower count. Facebook Pages have none. Use the latest captured_at per account.',
  media: "Posts (not stories) of every platform; join accounts on ig_id for a.platform. media_product_type: Instagram FEED/REELS, Facebook 'FB_POST', Threads 'THREADS'. posted_at is epoch ms: use date(posted_at/1000,'unixepoch','localtime') for 'YYYY-MM-DD'. Content type: media_product_type = 'REELS' → reels; media_type TEXT_POST/TEXT/LINK/STATUS → text; otherwise CAROUSEL_ALBUM → carousel, IMAGE → image, VIDEO → video. posted_weekday 0 = Sunday; posted_hour 0–23 local. Exclude is_deleted = 1.",
  media_latest: 'Latest lifetime totals per post (join media on media_id). engagement_rate is already a percentage: (likes+comments+saved+shares+reposts+quotes) / followers * 100. reach is NULL on Threads (use views); saved exists on Instagram only; comments = replies on Threads; reposts/quotes are Threads-only; clicks = Facebook link clicks.',
  media_insight_snapshots: 'Cumulative metric values per post over time (long format). captured_at epoch ms; age_hours since posting. Use media_latest for current totals.',
  stories: 'Stories. posted_at/captured_at epoch ms. completion_rate is a 0–1 fraction (multiply by 100 for %).',
  comments: 'Post comments. created_at epoch ms. is_from_owner = 1 for the account\'s own replies; reply_latency_minutes on owner replies.',
  ad_accounts: 'Meta ad accounts. currency = ISO code per ad account (TRY, USD, EUR…): never add money across different currencies; group by currency. monthly_budget is in that currency. linked_ig_id → accounts.ig_id (the client\'s Instagram account or Facebook Page).',
  ad_insights_daily: "One row per (act_id, date 'YYYY-MM-DD', level, object_id). level = account | campaign | adset | ad; for totals use level = 'account' only (the other levels repeat the same spend). spend/cpc/cpm/cost_per_result are in the ad account's currency. ctr is already a percentage. results are counted per result_type.",
  ad_insights_breakdown: "Account-level daily ad metrics split by breakdown (age | gender | publisher_platform) and bucket. date 'YYYY-MM-DD'; spend in the ad account's currency.",
  ad_media_links: 'Which ads promote which post (media_id; Instagram or Facebook).',
  ad_budget_overrides: 'Manual budgets per campaign/adset in the ad account currency.',
  competitors: 'Public competitor accounts, each linked to one tracked account (linked_ig_id). No reach data for competitors.',
  competitor_snapshots: "Daily public stats per competitor. date = 'YYYY-MM-DD'. avg_likes/avg_comments are per recent post.",
  notes: 'User notes attached to an entity (entity_type/entity_id). created_at epoch ms.',
  planner_posts: "Posts planned/scheduled in the MetaDash Planner (not yet necessarily published). ref = human code like 'P-0042'. status = draft | in_review | changes_requested | approved | scheduled | publishing | published | partial | failed | archived. scheduled_at/created_at/updated_at/approved_at are epoch ms UTC (NULL scheduled_at = unscheduled draft). labels = JSON array. version increases on every content change. Exclude deleted_at IS NOT NULL.",
  planner_targets: "One row per planned post × account (join planner_posts on post_id; account_id = accounts.ig_id). platform = instagram | facebook | threads. format: Instagram image/carousel/reel/story, Facebook text/link/photo/album/video/reel, Threads text/image/video/carousel. state = idle | queued | hosting | container | ready | handed_off (scheduled on Facebook itself) | publishing | commenting | published | failed | canceled | missed | paused. media_key = media.media_id of the published post once synced (join media on media_id to get its performance). published_at epoch ms.",
  planner_assets: 'Media files in the planner library. kind = image | video; bytes, width/height px, duration_ms, fps. created_at epoch ms.',
  planner_post_assets: "Which media files a planned post uses (post_id → planner_posts.id, asset_id → planner_assets.id); role = media | cover; position = order in a carousel.",
  brand_voice: "Per-account brand voice used by the AI studio (account_id = accounts.ig_id). brief = the editable voice description; profile = JSON style stats; source = manual | ai | ai_edited; ai_disabled = 1 means the account opted out of AI.",
  caption_variants: "AI caption variants for a planned post (post_id → planner_posts.id). label A/B/C, lang tr|en, angle = the variant's approach (question-hook, story, benefit…); chosen = 1 for the one used.",
  ab_tests: "Caption A/B experiments. This is variant tagging across separate posts (not a true split test). variable = what differs (caption_hook | length | emoji | cta | hashtags | other); metric = reach_lift | er | save_rate | views_lift; status = running | concluded; conclusion = free text. created_at/concluded_at epoch ms.",
  ab_test_items: "Posts assigned to an A/B test arm (test_id → ab_tests.id; arm = 'A' | 'B' | …). media_key = media.media_id of the published post (join media / media_latest for results); target_id → planner_targets.id when it came from the Planner.",
  planner_audit: "Planner history: one row per action (created, edited, approved, scheduled, published, failed, …). at epoch ms; actor = user | worker | system | client; detail = JSON.",
};

/** Distinct values listed for a few enum-like columns, so the model uses real names. */
const ENUMS = [
  ['accounts', 'platform'],
  ['account_insights_daily', 'metric'],
  ['media', 'media_product_type'],
  ['media', 'media_type'],
  ['media_insight_snapshots', 'metric'],
  ['ad_insights_daily', 'result_type'],
  ['ad_accounts', 'currency'],
];
const ENUM_MAX = 30;

/**
 * Compact, stable schema text for the system prompt: tables sorted by name, columns in declaration order.
 * Output only changes when the schema or the listed enum values change, which keeps provider prompt caching effective.
 */
export function buildSchemaDescription(db = getDb()) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name).filter((n) => !HIDDEN_TABLES.has(n));
  const enums = enumValues(db, new Set(tables));
  return tables.map((name) => describeTable(db, name, enums)).join('\n');
}

function describeTable(db, name, enums) {
  const cols = db.prepare(`PRAGMA table_info("${name}")`).all().filter((c) => !HIDDEN_COLUMN.test(c.name));
  const colText = cols.map((c) => `${c.name} ${c.type || 'ANY'}${c.pk ? ' PK' : ''}`).join(', ');
  const lines = [`${name}(${colText})`];
  if (NOTES[name]) lines.push(`  -- ${NOTES[name]}`);
  for (const [col, values] of enums.get(name) ?? []) lines.push(`  -- ${col} values: ${values.join(', ')}`);
  return lines.join('\n');
}

function enumValues(db, tables) {
  const out = new Map();
  for (const [table, col] of ENUMS) {
    if (!tables.has(table)) continue;
    const values = db.prepare(`SELECT DISTINCT "${col}" AS v FROM "${table}" WHERE "${col}" IS NOT NULL ORDER BY v LIMIT ${ENUM_MAX}`).all().map((r) => String(r.v));
    if (values.length) out.set(table, [...(out.get(table) ?? []), [col, values]]);
  }
  return out;
}
