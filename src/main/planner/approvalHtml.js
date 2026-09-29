import { esc, brandBar, footerHtml, recolorAccent, BRAND_CSS } from '../export/brandingHtml.js';
import { CODE_PREFIX, clientScript } from './approvalClient.js';

/**
 * Self-contained client approval pack (v1.4 plan §8): one HTML file with inline CSS, base64 thumbnails and an offline
 * response form. Pure — callers pass posts, account names and image data URLs. `pdf: true` drops the form and script
 * (printToPDF) and asks the client to reply by email quoting the refs instead.
 */
const L = {
  en: {
    title: 'Content for approval', client: 'Client', posts: '{n} posts', version: 'version {v}', unscheduled: 'Not scheduled yet',
    caption: 'Caption', first_comment: 'First comment', notes: 'Internal notes', caption_for: 'Caption for {p}', no_media: 'Text post', video: 'Video',
    approve: 'Approve', changes: 'Request changes', none: 'No decision', comment: 'Comment (optional)', your_name: 'Your name',
    respond_title: 'Your response', respond_help: 'Choose Approve or Request changes for each post, then press "Copy response" and send the code back (email, chat…). Nothing is sent from this page.',
    copy: 'Copy response', empty: 'No decisions yet.', ready: 'Response for {n} post(s) is ready — copy and send it.', copied: 'Copied. Paste it into your reply.',
    pdf_reply: 'To respond, reply by email quoting each reference, e.g. "P-0042: approved" or "P-0043: change the first line".',
    generated: 'Prepared on {d}.', credit: 'Prepared with MetaDash — the preview approximates how the post will look.',
  },
  tr: {
    title: 'Onay bekleyen içerikler', client: 'Müşteri', posts: '{n} gönderi', version: 'sürüm {v}', unscheduled: 'Henüz planlanmadı',
    caption: 'Metin', first_comment: 'İlk yorum', notes: 'İç notlar', caption_for: '{p} metni', no_media: 'Metin gönderisi', video: 'Video',
    approve: 'Onayla', changes: 'Değişiklik iste', none: 'Karar yok', comment: 'Yorum (isteğe bağlı)', your_name: 'Adınız',
    respond_title: 'Yanıtınız', respond_help: 'Her gönderi için Onayla veya Değişiklik iste seçin, ardından "Yanıtı kopyala"ya basıp kodu geri gönderin (e-posta, mesaj…). Bu sayfadan hiçbir şey gönderilmez.',
    copy: 'Yanıtı kopyala', empty: 'Henüz karar yok.', ready: '{n} gönderi için yanıt hazır — kopyalayıp gönderin.', copied: 'Kopyalandı. Yanıtınıza yapıştırın.',
    pdf_reply: 'Yanıt vermek için her referansı belirterek e-postayla dönün, ör. "P-0042: onaylandı" veya "P-0043: ilk satırı değiştirin".',
    generated: '{d} tarihinde hazırlandı.', credit: 'MetaDash ile hazırlandı — önizleme gönderinin görünümüne yaklaşık bir örnektir.',
  },
};
const PLATFORM = {
  instagram: { name: 'Instagram', short: 'IG', color: '#E1306C' },
  facebook: { name: 'Facebook', short: 'FB', color: '#1877F2' },
  threads: { name: 'Threads', short: 'Threads', color: '#101010' },
};

const CSS = `:root{--accent:#4F7CFF;--ink:#14171f;--ink-1:#3b4150;--ink-2:#6b7280;--line:#e5e7eb;--bg:#f6f7fb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:880px;margin:0 auto;padding:28px 20px 40px}h1{font-size:24px;margin:16px 0 4px}.meta{color:var(--ink-2);font-size:13px}
.post{background:#fff;border:1px solid var(--line);border-radius:14px;margin:18px 0;padding:18px;break-inside:avoid;page-break-inside:avoid}
.ph{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px}.ref{font-weight:700;color:var(--accent)}.when{font-weight:600}.ver{color:var(--ink-2);font-size:12px;margin-left:auto}
.badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 9px;font-size:12px;color:#fff}
.grid{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:18px}@media (max-width:640px){.grid{grid-template-columns:minmax(0,1fr)}}
.mock{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}.mh{display:flex;align-items:center;gap:8px;padding:8px 10px;font-weight:600;font-size:13px}
.av{width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg,#5B8CFF,#C06CE8)}.media{position:relative;background:#eef0f5;aspect-ratio:4/5;display:flex;align-items:center;justify-content:center;color:var(--ink-2)}
.media img{width:100%;height:100%;object-fit:cover;display:block}.count{position:absolute;top:8px;right:8px;background:rgba(0,0,0,.6);color:#fff;border-radius:10px;font-size:11px;padding:1px 7px}
.play{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px;color:rgba(255,255,255,.9);text-shadow:0 2px 8px rgba(0,0,0,.4)}
.strip{display:flex;gap:4px;padding:6px}.strip img{width:40px;height:40px;object-fit:cover;border-radius:4px}.mc{padding:8px 10px;font-size:13px;white-space:pre-wrap;word-wrap:break-word}
.lbl{font-size:12px;color:var(--ink-2);text-transform:uppercase;letter-spacing:.04em;margin:10px 0 2px}.text{white-space:pre-wrap;word-wrap:break-word}.notes{background:#fff8e6;border-radius:8px;padding:8px}
.resp{margin-top:14px;border-top:1px dashed var(--line);padding-top:12px}.resp label{margin-right:14px;cursor:pointer}.resp textarea{width:100%;margin-top:8px}
textarea,input[type=text]{font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px}.panel{background:#fff;border:2px solid var(--accent);border-radius:14px;padding:18px;margin-top:24px}
button{font:inherit;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 16px;cursor:pointer}#mdap-code{width:100%;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
.foot{color:var(--ink-2);font-size:12px;margin-top:28px;border-top:1px solid var(--line);padding-top:12px}
@media print{body{background:#fff}.wrap{padding:0}.post{border-color:#ccc}.panel,.resp{display:none}}`;

const fill = (s, vars = {}) => Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, String(v)), s);

function fmtWhen(at, timezone, lang) {
  if (at == null) return null;
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false };
  const locale = lang === 'tr' ? 'tr-TR' : 'en-GB';
  try {
    return new Date(at).toLocaleString(locale, timezone ? { ...opts, timeZone: timezone, timeZoneName: 'short' } : opts);
  } catch {
    return new Date(at).toLocaleString(locale, opts);
  }
}

function badge(target, accounts) {
  const p = PLATFORM[target.platform] ?? { name: target.platform, short: target.platform, color: '#555' };
  const acc = accounts[target.accountId];
  const who = acc?.username ? ` @${acc.username}` : '';
  return `<span class="badge" style="background:${p.color}">${esc(p.short)}${esc(who)}</span>`;
}

function mockPreview(post, { images, accounts, labels }) {
  const media = (post.assets ?? []).filter((a) => a.role === 'media').sort((a, b) => a.position - b.position);
  const first = media[0];
  const firstTarget = post.targets?.[0];
  const acc = firstTarget ? accounts[firstTarget.accountId] : null;
  const img = (m) => (m && images[m.assetId] ? `<img src="${images[m.assetId]}" alt="${esc(m.altText ?? '')}">` : '');
  const main = first
    ? `<div class="media">${img(first) || esc(first.asset?.kind === 'video' ? labels.video : '')}${first.asset?.kind === 'video' ? '<div class="play">▶</div>' : ''}${media.length > 1 ? `<span class="count">1/${media.length}</span>` : ''}</div>`
    : '';
  const strip = media.length > 1 ? `<div class="strip">${media.slice(1, 10).map(img).join('')}</div>` : '';
  const caption = post.caption ? `<div class="mc"><b>${esc(acc?.username ?? '')}</b> ${esc(post.caption)}</div>` : `<div class="mc">${first ? '' : esc(labels.no_media)}</div>`;
  return `<div class="mock"><div class="mh"><span class="av"></span>${esc(acc?.username ?? '')}</div>${main}${strip}${caption}</div>`;
}

function details(post, { accounts, labels, includeNotes }) {
  const parts = [];
  parts.push(`<div class="lbl">${esc(labels.caption)}</div><div class="text">${esc(post.caption ?? '')}</div>`);
  for (const t of post.targets ?? []) {
    if (!t.captionOverride) continue;
    const name = `${PLATFORM[t.platform]?.name ?? t.platform}${accounts[t.accountId]?.username ? ` @${accounts[t.accountId].username}` : ''}`;
    parts.push(`<div class="lbl">${esc(fill(labels.caption_for, { p: name }))}</div><div class="text">${esc(t.captionOverride)}</div>`);
  }
  if (post.firstComment) parts.push(`<div class="lbl">${esc(labels.first_comment)}</div><div class="text">${esc(post.firstComment)}</div>`);
  if (includeNotes && post.notes) parts.push(`<div class="lbl">${esc(labels.notes)}</div><div class="text notes">${esc(post.notes)}</div>`);
  return parts.join('');
}

function responseForm(ref, labels) {
  const r = esc(ref);
  return `<div class="resp"><label><input type="radio" name="d-${r}" value="a"> ${esc(labels.approve)}</label><label><input type="radio" name="d-${r}" value="c"> ${esc(labels.changes)}</label>`
    + `<textarea id="n-${r}" rows="2" placeholder="${esc(labels.comment)}"></textarea></div>`;
}

function postCard(post, ctx) {
  const when = fmtWhen(post.scheduledAt, post.timezone, ctx.lang) ?? ctx.labels.unscheduled;
  const title = post.title ? ` · ${esc(post.title)}` : '';
  return `<section class="post" id="post-${esc(post.ref)}"><div class="ph"><span class="ref">${esc(post.ref)}</span><span class="when">${esc(when)}</span>${title}`
    + `${(post.targets ?? []).map((t) => badge(t, ctx.accounts)).join('')}<span class="ver">${esc(fill(ctx.labels.version, { v: post.version }))}</span></div>`
    + `<div class="grid">${mockPreview(post, ctx)}<div>${details(post, ctx)}</div></div>${ctx.pdf ? '' : responseForm(post.ref, ctx.labels)}</section>`;
}

/**
 * @param {{ pack: { id, secret, items: { postId, ref, version }[] }, posts: object[], accounts?: Record<string, { username, platform }>,
 *   images?: Record<number, string>, branding: object, lang?: 'en'|'tr', title?: string, clientName?: string, includeNotes?: boolean,
 *   pdf?: boolean, now?: number }} p
 * @returns {string} HTML document
 */
export function buildApprovalHtml({ pack, posts, accounts = {}, images = {}, branding, lang = 'en', title, clientName, includeNotes = false, pdf = false, now = Date.now() }) {
  const labels = L[lang === 'tr' ? 'tr' : 'en'];
  const ctx = { accounts, images, labels, includeNotes, pdf, lang };
  const heading = title?.trim() || labels.title;
  const dateText = fmtWhen(now, null, lang);
  const meta = [clientName ? `${labels.client}: ${clientName}` : null, fill(labels.posts, { n: posts.length })].filter(Boolean).join(' · ');
  const csp = `default-src 'none'; img-src data:; style-src 'unsafe-inline'${pdf ? '' : "; script-src 'unsafe-inline'"}; form-action 'none'; base-uri 'none'`;
  const clientData = {
    prefix: CODE_PREFIX, packId: pack.id, secret: pack.secret, items: pack.items.map((i) => ({ ref: i.ref, v: i.version })),
    labels: { ready: labels.ready, empty: labels.empty, copied: labels.copied },
  };
  const respond = pdf
    ? `<div class="panel"><div class="text">${esc(labels.pdf_reply)}</div></div>`
    : `<div class="panel"><h2>${esc(labels.respond_title)}</h2><p class="meta">${esc(labels.respond_help)}</p>`
      + `<p><input type="text" id="mdap-by" placeholder="${esc(labels.your_name)}" maxlength="200"></p>`
      + `<textarea id="mdap-code" rows="4" readonly></textarea><p><button type="button" id="mdap-copy">${esc(labels.copy)}</button> <span id="mdap-status" class="meta"></span></p></div>`;
  const body = `<div class="wrap">${brandBar(branding)}<h1>${esc(heading)}</h1><div class="meta">${esc(meta)} · ${esc(dateText)}</div>`
    + `${posts.map((p) => postCard(p, ctx)).join('')}${respond}`
    + `<div class="foot">${footerHtml(branding, labels.credit, fill(labels.generated, { d: dateText }))}</div></div>`;
  const script = pdf ? '' : `<script>${clientScript(clientData)}</script>`;
  const html = `<!doctype html><html lang="${lang === 'tr' ? 'tr' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><title>${esc(heading)}</title>`
    + `<style>${CSS}${BRAND_CSS}</style></head><body>${body}${script}</body></html>`;
  return recolorAccent(html, branding?.accent);
}
