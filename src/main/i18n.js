import { getConfig } from './config/store.js';

/** Main-process user-facing messages: { key: [en, tr] }. English is the default. */
const M = {
  // setup
  app_id_digits: ['App ID must contain digits only.', 'App ID yalnızca rakamlardan oluşmalı.'],
  app_secret_short: ['App Secret is missing or too short.', 'App Secret eksik veya çok kısa.'],
  save_app_first: ['Save the App ID and App Secret first (step 2).', 'Önce App ID ve App Secret kaydedin (2. adım).'],
  token_empty: ['The token looks empty. Copy it from Graph API Explorer and paste it here.', 'Token boş görünüyor. Graph API Explorer\'dan kopyalayıp yapıştırın.'],
  meta_connection: ['Meta connection', 'Meta bağlantısı'],
  demo_dev_only: ['Demo data is only available in development builds.', 'Demo verisi yalnızca geliştirme sürümünde kullanılabilir.'],
  // sync
  sync_running: ['An update is already running.', 'Bir güncelleme zaten çalışıyor.'],
  no_profile: ['Complete setup first (no Meta connection).', 'Önce kurulumu tamamlayın (Meta bağlantısı yok).'],
  sync_cancelled: ['Cancelled', 'İptal edildi'],
  token_invalid: ['Token invalid', 'Token geçersiz'],
  token_unreadable: ['Token could not be read', 'Token okunamadı'],
  sync_errors: ['{n} errors', '{n} hata'],
  demo_no_api: ['Demo mode: no real API calls were made', 'Demo modu: gerçek API çağrısı yapılmadı'],
  // competitors / accounts
  username_empty: ['Username cannot be empty.', 'Kullanıcı adı boş olamaz.'],
  pick_competitor_account: ['Select the account to link the competitor to.', 'Rakibin bağlanacağı hesabı seçin.'],
  account_not_found: ['Account not found.', 'Hesap bulunamadı.'],
  no_account_selected: ['No account selected.', 'Hesap seçilmedi.'],
  competitor_note: ['Reach is not available for competitors; only public follower, post and like/comment counts are shown.', 'Rakiplerde erişim verisi bulunmaz; yalnızca herkese açık takipçi, gönderi ve beğeni/yorum sayıları gösterilir.'],
  tag_name_empty: ['Tag name cannot be empty.', 'Etiket adı boş olamaz.'],
  note_empty: ['Note cannot be empty.', 'Not boş olamaz.'],
  // analytics
  invalid_range: ['Invalid date range.', 'Geçersiz tarih aralığı.'],
  range_order: ['Start date cannot be after the end date.', 'Başlangıç tarihi bitişten sonra olamaz.'],
  ad_account_not_found: ['Ad account not found.', 'Reklam hesabı bulunamadı.'],
  // export
  no_tables: ['There is no table to export.', 'Dışa aktarılacak tablo yok.'],
  image_filter: ['Image', 'Görsel'],
  unknown_template: ['Unknown template: {t}', 'Bilinmeyen şablon: {t}'],
  basket_empty: ['The report basket is empty.', 'Rapor sepeti boş.'],
  select_only: ['Only SELECT queries are allowed.', 'Yalnızca SELECT sorgularına izin verilir.'],
  // system / transfer
  http_only: ['Only http(s) links can be opened.', 'Yalnızca http(s) bağlantıları açılabilir.'],
  guide_missing: ['Setup guide not found ({f}).', 'Kılavuz dosyası bulunamadı ({f}).'],
  unknown_setting: ['Unknown setting: {k}', 'Bilinmeyen ayar: {k}'],
  not_sqlite: ['The selected file is not an SQLite database.', 'Seçilen dosya bir SQLite veritabanı değil.'],
  transfer_filter: ['MetaDash export', 'MetaDash aktarım'],
  not_transfer: ['The selected file is not a MetaDash export file.', 'Seçilen dosya bir MetaDash aktarım dosyası değil.'],
  no_tables_in_file: ['The file contains no MetaDash tables.', 'Dosyada MetaDash tabloları yok.'],
  passphrase_required: ['The Meta token/secret in this file is passphrase-encrypted; enter the passphrase.', 'Bu dosyadaki Meta token/secret parola ile şifrelenmiş; parolayı girin.'],
  passphrase_wrong: ['Wrong passphrase.', 'Parola yanlış.'],
};

/** Current UI language from config ('en' | 'tr'); falls back to 'en'. */
export function currentLang() {
  try { return getConfig('lang') === 'tr' ? 'tr' : 'en'; } catch { return 'en'; }
}

/** Localized message for key with {var} interpolation; lang defaults to the configured language. */
export function msg(key, vars, lang = currentLang()) {
  let s = M[key]?.[lang === 'tr' ? 1 : 0] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Intl locale for number/date formatting in exports, following the configured language. */
export function locale(lang = currentLang()) {
  return lang === 'tr' ? 'tr-TR' : 'en-US';
}
