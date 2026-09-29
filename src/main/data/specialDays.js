/**
 * Special days for monthly content ideas (v1.5 chunk C): Turkish national days and holidays plus widely used global
 * marketing / awareness days. This is an editable, approximate list — not an official calendar:
 *  - `date: 'MM-DD'`        fixed every year
 *  - `rule: {…}`            computed: nth weekday of a month (+ offset days), or 'easter' (Western, Gregorian computus)
 *  - `dates: {year: 'MM-DD'}` lunar holidays. VERIFY every year against Diyanet (Turkey follows its own calculated
 *                            calendar; other countries can differ by ±1 day). Marked `approx: true`.
 *  - `solemn: true`         commemorations: the prompt asks for respectful content and no promotions.
 * Users add their own days in Settings → Studio → Ideas (config 'studio.specialDays'), validated by validateCustomDays.
 */
const DAY_MS = 86_400_000;

export const SPECIAL_DAYS = Object.freeze([
  // ---- global ------------------------------------------------------------------------------------------------
  { id: 'new_year', date: '01-01', region: 'global', kind: 'holiday', name: { en: "New Year's Day", tr: 'Yılbaşı' } },
  { id: 'valentines', date: '02-14', region: 'global', kind: 'marketing', name: { en: "Valentine's Day", tr: 'Sevgililer Günü' } },
  { id: 'womens_day', date: '03-08', region: 'global', kind: 'awareness', name: { en: "International Women's Day", tr: 'Dünya Kadınlar Günü' } },
  { id: 'consumer_rights', date: '03-15', region: 'global', kind: 'awareness', name: { en: 'World Consumer Rights Day', tr: 'Dünya Tüketici Hakları Günü' } },
  { id: 'happiness_day', date: '03-20', region: 'global', kind: 'awareness', name: { en: 'International Day of Happiness', tr: 'Uluslararası Mutluluk Günü' } },
  { id: 'april_fools', date: '04-01', region: 'global', kind: 'marketing', name: { en: "April Fools' Day", tr: '1 Nisan Şaka Günü' } },
  { id: 'health_day', date: '04-07', region: 'global', kind: 'awareness', name: { en: 'World Health Day', tr: 'Dünya Sağlık Günü' } },
  { id: 'easter', rule: 'easter', region: 'global', kind: 'holiday', name: { en: 'Easter Sunday', tr: 'Paskalya' } },
  { id: 'earth_day', date: '04-22', region: 'global', kind: 'awareness', name: { en: 'Earth Day', tr: 'Dünya Günü' } },
  { id: 'labour_day', date: '05-01', region: 'global', kind: 'holiday', name: { en: 'Labour Day', tr: 'Emek ve Dayanışma Günü' } },
  { id: 'mothers_day', rule: { month: 5, weekday: 0, nth: 2 }, region: 'global', kind: 'marketing', name: { en: "Mother's Day (TR/US: 2nd Sunday of May)", tr: 'Anneler Günü' } },
  { id: 'environment_day', date: '06-05', region: 'global', kind: 'awareness', name: { en: 'World Environment Day', tr: 'Dünya Çevre Günü' } },
  { id: 'fathers_day', rule: { month: 6, weekday: 0, nth: 3 }, region: 'global', kind: 'marketing', name: { en: "Father's Day (TR/US: 3rd Sunday of June)", tr: 'Babalar Günü' } },
  { id: 'music_day', date: '06-21', region: 'global', kind: 'awareness', name: { en: 'World Music Day', tr: 'Dünya Müzik Günü' } },
  { id: 'social_media_day', date: '06-30', region: 'global', kind: 'marketing', name: { en: 'Social Media Day', tr: 'Sosyal Medya Günü' } },
  { id: 'coffee_day', date: '10-01', region: 'global', kind: 'marketing', name: { en: 'International Coffee Day', tr: 'Uluslararası Kahve Günü' } },
  { id: 'animal_day', date: '10-04', region: 'global', kind: 'awareness', name: { en: 'World Animal Day', tr: 'Dünya Hayvanları Koruma Günü' } },
  { id: 'food_day', date: '10-16', region: 'global', kind: 'awareness', name: { en: 'World Food Day', tr: 'Dünya Gıda Günü' } },
  { id: 'halloween', date: '10-31', region: 'global', kind: 'marketing', name: { en: 'Halloween', tr: 'Cadılar Bayramı' } },
  { id: 'singles_day', date: '11-11', region: 'global', kind: 'marketing', name: { en: "Singles' Day (11.11 sales)", tr: '11.11 İndirim Günü' } },
  { id: 'black_friday', rule: { month: 11, weekday: 4, nth: 4, offset: 1 }, region: 'global', kind: 'marketing', name: { en: 'Black Friday', tr: 'Black Friday (Efsane Cuma)' } },
  { id: 'cyber_monday', rule: { month: 11, weekday: 4, nth: 4, offset: 4 }, region: 'global', kind: 'marketing', name: { en: 'Cyber Monday', tr: 'Cyber Monday' } },
  { id: 'christmas', date: '12-25', region: 'global', kind: 'holiday', name: { en: 'Christmas Day', tr: 'Noel' } },
  { id: 'new_years_eve', date: '12-31', region: 'global', kind: 'marketing', name: { en: "New Year's Eve", tr: 'Yılbaşı Gecesi' } },
  // ---- Türkiye -----------------------------------------------------------------------------------------------
  { id: 'tr_medicine_day', date: '03-14', region: 'tr', kind: 'awareness', name: { en: 'Medicine Day (TR)', tr: '14 Mart Tıp Bayramı' } },
  { id: 'tr_canakkale', date: '03-18', region: 'tr', kind: 'commemoration', solemn: true, name: { en: 'Çanakkale Victory and Martyrs\' Day (TR)', tr: '18 Mart Çanakkale Zaferi ve Şehitleri Anma Günü' } },
  { id: 'tr_nevruz', date: '03-21', region: 'tr', kind: 'holiday', name: { en: 'Nevruz', tr: 'Nevruz' } },
  { id: 'tr_children', date: '04-23', region: 'tr', kind: 'holiday', name: { en: 'National Sovereignty and Children\'s Day (TR)', tr: '23 Nisan Ulusal Egemenlik ve Çocuk Bayramı' } },
  { id: 'tr_youth', date: '05-19', region: 'tr', kind: 'holiday', name: { en: 'Commemoration of Atatürk, Youth and Sports Day (TR)', tr: '19 Mayıs Atatürk\'ü Anma, Gençlik ve Spor Bayramı' } },
  { id: 'tr_democracy', date: '07-15', region: 'tr', kind: 'commemoration', solemn: true, name: { en: 'Democracy and National Unity Day (TR)', tr: '15 Temmuz Demokrasi ve Milli Birlik Günü' } },
  { id: 'tr_victory', date: '08-30', region: 'tr', kind: 'holiday', name: { en: 'Victory Day (TR)', tr: '30 Ağustos Zafer Bayramı' } },
  { id: 'tr_republic', date: '10-29', region: 'tr', kind: 'holiday', name: { en: 'Republic Day (TR)', tr: '29 Ekim Cumhuriyet Bayramı' } },
  { id: 'tr_ataturk', date: '11-10', region: 'tr', kind: 'commemoration', solemn: true, name: { en: 'Atatürk Memorial Day (TR)', tr: '10 Kasım Atatürk\'ü Anma Günü' } },
  { id: 'tr_teachers', date: '11-24', region: 'tr', kind: 'awareness', name: { en: 'Teachers\' Day (TR)', tr: '24 Kasım Öğretmenler Günü' } },
  // Lunar (Hijri) dates — approximate, VERIFY against the Diyanet calendar each year.
  { id: 'tr_ramadan_start', dates: { 2026: '02-19', 2027: '02-08', 2028: '01-28' }, approx: true, region: 'tr', kind: 'holiday', name: { en: 'Start of Ramadan', tr: 'Ramazan ayının başlangıcı' } },
  { id: 'tr_ramazan_bayrami', dates: { 2026: '03-20', 2027: '03-09', 2028: '02-26' }, approx: true, days: 3, region: 'tr', kind: 'holiday', name: { en: 'Eid al-Fitr (Ramazan Bayramı, 3 days)', tr: 'Ramazan Bayramı (3 gün)' } },
  { id: 'tr_kurban_bayrami', dates: { 2026: '05-27', 2027: '05-16', 2028: '05-04' }, approx: true, days: 4, region: 'tr', kind: 'holiday', name: { en: 'Eid al-Adha (Kurban Bayramı, 4 days)', tr: 'Kurban Bayramı (4 gün)' } },
]);

export const MAX_CUSTOM_DAYS = 100;
const NAME_MAX = 80;
const MMDD_RE = /^(\d{2})-(\d{2})$/;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Western Easter Sunday (anonymous Gregorian algorithm) → { month, day }. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/** nth weekday (0 = Sunday) of a month, plus `offset` days → 'YYYY-MM-DD'. */
export function nthWeekday(year, month, weekday, nth, offset = 0) {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const day = 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  const d = new Date(Date.UTC(year, month - 1, day) + offset * DAY_MS);
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The date of one built-in day in `year` ('YYYY-MM-DD'), or null when unknown for that year (lunar table gap). */
export function dateOf(entry, year) {
  if (entry.date) return `${year}-${entry.date}`;
  if (entry.rule === 'easter') { const { month, day } = easterSunday(year); return ymd(year, month, day); }
  if (entry.rule) return nthWeekday(year, entry.rule.month, entry.rule.weekday, entry.rule.nth, entry.rule.offset ?? 0);
  const md = entry.dates?.[year];
  return md ? `${year}-${md}` : null;
}

function validMonthDay(m, d, y = 2024) { // 2024: leap year, so 02-29 is accepted for yearly entries
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
}

/**
 * Validates the user's own days (config 'studio.specialDays'): [{ date: 'MM-DD' | 'YYYY-MM-DD', name, region? }].
 * Returns a clean copy; throws Error with `.field` on bad input (the registry maps it to an i18n error).
 */
export function validateCustomDays(list) {
  if (!Array.isArray(list) || list.length > MAX_CUSTOM_DAYS) throw Object.assign(new Error('specialDays'), { field: 'specialDays' });
  return list.map((raw, i) => {
    if (!raw || typeof raw !== 'object') throw Object.assign(new Error('specialDays'), { field: `specialDays[${i}]` });
    const date = String(raw.date ?? '').trim();
    const name = String(raw.name ?? '').trim().slice(0, NAME_MAX);
    const mmdd = MMDD_RE.exec(date);
    const full = YMD_RE.exec(date);
    const ok = mmdd ? validMonthDay(Number(mmdd[1]), Number(mmdd[2])) : full ? Number(full[1]) >= 2000 && Number(full[1]) <= 2100 && validMonthDay(Number(full[2]), Number(full[3]), Number(full[1])) : false;
    if (!ok) throw Object.assign(new Error('specialDays'), { field: `specialDays[${i}].date` });
    if (!name) throw Object.assign(new Error('specialDays'), { field: `specialDays[${i}].name` });
    return { date, name };
  });
}

/**
 * Special days that fall in one month: built-in (all regions) + the user's list, sorted by date.
 * @returns {{ id, date: 'YYYY-MM-DD', name: string, region: 'tr'|'global'|'custom', kind, approx, solemn, days, custom }[]}
 */
export function specialDaysFor(year, month, { custom = [], lang = 'en', regions } = {}) {
  const prefix = `${year}-${pad(month)}-`;
  const want = regions ? new Set(regions) : null;
  const out = [];
  for (const e of SPECIAL_DAYS) {
    if (want && !want.has(e.region)) continue;
    const date = dateOf(e, year);
    if (!date?.startsWith(prefix)) continue;
    out.push({ id: e.id, date, name: e.name[lang] ?? e.name.en, region: e.region, kind: e.kind, approx: !!e.approx, solemn: !!e.solemn, days: e.days ?? 1, custom: false });
  }
  for (const [i, c] of custom.entries()) {
    const date = c.date.length === 5 ? `${year}-${c.date}` : c.date;
    if (!date.startsWith(prefix)) continue;
    out.push({ id: `custom_${i}`, date, name: c.name, region: 'custom', kind: 'custom', approx: false, solemn: false, days: 1, custom: true });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
