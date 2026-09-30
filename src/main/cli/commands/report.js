import fs from 'node:fs';
import path from 'node:path';
import { EXIT } from '../exitCodes.js';
import { listOpt, cliT, usageError, oneOf, services } from '../args.js';
import { selectAccounts, resolvePlatforms } from '../resolve.js';
import {
  REPORT_TEMPLATES, ACCOUNT_TEMPLATES, SINGLE_ACCOUNT_TEMPLATES, PERIOD_PRESETS,
  resolvePeriod, resolveSections, resolveFormat, buildReportParams, expandOutPath, isBatchPattern,
} from '../../export/params.js';
import { writeHtmlReport, TEMPLATE_SECTIONS } from '../../export/htmlReport.js';
import { reportSheets } from '../../export/xlsxReport.js';
import { writeWorkbook } from '../../export/xlsx.js';
import { allReportSections } from '../../export/reportSections/index.js';
import { loadBranding } from '../../export/brandingStore.js';
import { listAccounts } from '../../db/queries/accounts.js';
import { listTags } from '../../db/queries/tags.js';
import { KNOWN_PLATFORMS } from '../../providers/index.js';
import { currentLang } from '../../i18n.js';

/**
 * `metadash report` — renders the same reports as the Reports page (export/htmlReport.js, xlsxReport.js; PDF through a
 * hidden BrowserWindow exactly like the app, export/pdf.js). One file, or one file per account when --out contains
 * {account}. Exit: 0 ok, 2 usage, 3 some files failed, 1 all failed.
 */
const CLIENT_TEMPLATES = ['monthly', 'weekly_client', 'custom'];

const DEFAULTS = {
  listAccounts: () => listAccounts(), listTags, loadBranding, currentLang,
  knownPlatforms: KNOWN_PLATFORMS,
  templateSections: TEMPLATE_SECTIONS,
  extraSectionKeys: () => allReportSections().map((s) => s.key),
  now: () => new Date(),
  writers: {
    html: async (template, params, file) => writeHtmlReport(template, params, file),
    // Lazy: export/pdf.js needs Electron's BrowserWindow (hidden window + printToPDF), only loaded for PDF output.
    pdf: async (template, params, file) => (await import('../../export/pdf.js')).writePdfReport(template, params, file),
    xlsx: async (template, params, file) => writeWorkbook(file, reportSheets(template, params), { title: params.branding?.agencyName ?? '' }),
  },
  aiCommentary: async (template, params) => (await import('../../ai/service.js')).reportCommentary({ template, ...params }),
};

export const command = {
  name: 'report',
  summary: 'metadash report --template <t> [--account @x …|--client name|--tag name] [--period p | --from d --to d] [--format pdf|html|xlsx] --out <file>',
  help: [
    'Writes a report file, the same as Reports → Export in the app.',
    '',
    'Options:',
    `  -t, --template <t>      ${REPORT_TEMPLATES.join(', ')}`,
    '  --account <ref>         account(s) for monthly/weekly_client/custom/campaign (repeatable; @username, platform:@username, key)',
    '  --client <name>         every account of a client (repeatable)',
    '  --tag <name>            accounts with a tag; for portfolio/weekly: filter by tag (repeatable)',
    '  --platform <list>       only these platforms (portfolio/weekly filter, or narrows the selected accounts)',
    `  --period <p>            ${PERIOD_PRESETS.join(', ')}`,
    '  --from/--to <date>      explicit range, YYYY-MM-DD (wins over --period)',
    '  --format <f>            pdf, html or xlsx (default: from the --out extension, else pdf)',
    '  --sections <list>       only these sections; --exclude-sections <list> drops sections',
    '  --commentary <c>        none (default) or ai (AI draft, uses the AI provider set up in the app)',
    '  --commentary-file <f>   commentary text from a file',
    '  --cover-title <text>    cover title',
    '  -o, --out <file>        output file; tokens {account} {platform} {client} {template} {from} {to} {date} {format}.',
    '                          With {account}, one file per selected account.',
    '',
    'Report language: --lang (default: the app language). Branding: Settings → Report branding.',
    'Defaults: monthly → last_month, weekly/weekly_client → last_7d, portfolio/campaign → last_30d; custom needs a period.',
  ].join('\n'),
  options: {
    template: { type: 'string', short: 't' },
    account: { type: 'string', multiple: true },
    client: { type: 'string', multiple: true },
    tag: { type: 'string', multiple: true },
    platform: { type: 'string', multiple: true },
    period: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    format: { type: 'string' },
    sections: { type: 'string', multiple: true },
    'exclude-sections': { type: 'string', multiple: true },
    commentary: { type: 'string' },
    'commentary-file': { type: 'string' },
    'cover-title': { type: 'string' },
    out: { type: 'string', short: 'o' },
  },
  async run(values, io) {
    const s = services(io, DEFAULTS);
    const plan = planReport(values, io, s);
    return writeAll(plan, io, s);
  },
};

/** Validates the options and builds the list of files to write (pure apart from the DB reads). */
export function planReport(values, io, s) {
  const template = oneOf(io, values.template ?? io.positionals?.[0] ?? '', REPORT_TEMPLATES, '--template');
  const out = values.out;
  if (!out) throw usageError(io, 'cli_err_out_required');
  const format = resolveFormat({ format: values.format, out });
  const lang = io.lang ?? s.currentLang();
  const now = s.now();
  const range = resolvePeriod({ template, from: values.from, to: values.to, period: values.period, now });
  const platforms = resolvePlatforms(listOpt(values.platform), s.knownPlatforms, { lang: io.lang });
  const refs = listOpt(values.account);
  const clients = listOpt(values.client);
  const tags = listOpt(values.tag);
  const accountTemplate = ACCOUNT_TEMPLATES.includes(template);
  if (accountTemplate && !refs.length && !clients.length && !tags.length) throw usageError(io, 'cli_err_account_required', { template });
  if (!accountTemplate && (refs.length || clients.length)) throw usageError(io, 'cli_err_no_account_for_template', { template });
  if (!accountTemplate && isBatchPattern(out)) throw usageError(io, 'cli_err_account_token', { template });
  const available = [...(s.templateSections[template] ?? []), ...(CLIENT_TEMPLATES.includes(template) ? s.extraSectionKeys() : [])];
  const sections = resolveSections({ available, only: listOpt(values.sections), exclude: listOpt(values['exclude-sections']) });
  const commentaryMode = oneOf(io, values.commentary ?? 'none', ['none', 'ai'], '--commentary');
  const commentaryText = values['commentary-file'] ? readText(io, values['commentary-file']) : '';
  const base = { template, from: range.from, to: range.to, lang, sections, coverTitle: values['cover-title'], commentary: commentaryText, branding: s.loadBranding() };
  const job = (accounts, extra = {}) => ({
    params: buildReportParams({ ...base, igIds: accounts.map((a) => a.igId), ...extra }),
    file: path.resolve(expandOutPath(out, { account: accounts.length === 1 ? accounts[0].username : undefined, platform: accounts.length === 1 ? accounts[0].platform : undefined, client: accounts[0]?.clientName ?? undefined, template, from: range.from, to: range.to, format, now })),
    accounts: accounts.map((a) => ({ igId: a.igId, platform: a.platform, username: a.username })),
  });

  let jobs;
  if (accountTemplate) {
    const sel = selectAccounts({ refs, clients, tags, platforms }, { accounts: s.listAccounts(), tagList: s.listTags() }, { lang: io.lang });
    if (!sel.accounts.length) throw usageError(io, 'cli_err_no_accounts');
    if (isBatchPattern(out)) jobs = sel.accounts.map((a) => job([a]));
    else if (SINGLE_ACCOUNT_TEMPLATES.includes(template) && sel.accounts.length > 1) throw usageError(io, 'cli_err_single_account', { template, n: sel.accounts.length });
    else jobs = [job(sel.accounts)];
  } else {
    const sel = selectAccounts({ tags }, { accounts: [], tagList: tags.length ? s.listTags() : [] }, { lang: io.lang });
    jobs = [job([], { tagIds: sel.tagIds, platforms })];
  }
  const files = jobs.map((j) => j.file);
  if (new Set(files).size !== files.length) throw usageError(io, 'cli_err_out_collision');
  return { template, format, range, commentaryMode, jobs };
}

function readText(io, file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { throw usageError(io, 'cli_err_read_file', { file, error: e.message }); }
}

async function writeAll({ template, format, range, commentaryMode, jobs }, io, s) {
  const t = cliT(io);
  const { out } = io;
  const written = [];
  const failed = [];
  for (const j of jobs) {
    const label = j.accounts.map((a) => `@${a.username}`).join(', ') || template;
    try {
      let params = j.params;
      if (commentaryMode === 'ai') params = { ...params, commentary: await aiText(s, io, template, params) };
      out.info(t('cli_report_writing', { label, file: j.file }));
      fs.mkdirSync(path.dirname(j.file), { recursive: true });
      await s.writers[format](template, params, j.file);
      written.push({ file: j.file, format, template, from: range.from, to: range.to, accounts: j.accounts });
    } catch (e) {
      failed.push({ file: j.file, accounts: j.accounts, error: e?.message ?? String(e) });
      out.error(t('cli_report_failed', { label, error: e?.message ?? String(e) }));
    }
  }
  const code = !failed.length ? EXIT.OK : written.length ? EXIT.PARTIAL : EXIT.ERROR;
  if (out.json) out.result({ template, format, from: range.from, to: range.to, files: written, failed, exitCode: code });
  else for (const w of written) out.result(w.file);
  return code;
}

/** AI commentary draft; a failure only warns (the report is still written without commentary). */
async function aiText(s, io, template, params) {
  try {
    const res = await s.aiCommentary(template, params);
    return res?.text ?? '';
  } catch (e) {
    io.out.warn(cliT(io)('cli_report_ai_failed', { error: e?.message ?? String(e) }));
    return params.commentary ?? '';
  }
}
