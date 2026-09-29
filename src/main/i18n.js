import { getConfig } from './config/store.js';

/** Main-process user-facing messages: { key: [en, tr] }. English is the default. */
const M = {
  // setup
  app_id_digits: ['App ID must contain digits only.', 'App ID yalnızca rakamlardan oluşmalı.'],
  app_secret_short: ['App Secret is missing or too short.', 'App Secret eksik veya çok kısa.'],
  save_app_first: ['Save the App ID and App Secret first (step 2).', 'Önce App ID ve App Secret kaydedin (2. adım).'],
  token_empty: ['The token looks empty. Copy it from Graph API Explorer and paste it here.', 'Token boş görünüyor. Graph API Explorer\'dan kopyalayıp yapıştırın.'],
  meta_connection: ['Meta connection', 'Meta bağlantısı'],
  demo_real_connected: ['Demo data cannot be loaded while a real Meta connection exists. Use "Delete all data" in Settings first.', 'Gerçek bir Meta bağlantısı varken demo verisi yüklenemez. Önce Ayarlar\'dan "Tüm verileri sil"i kullanın.'],
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
  logo_invalid: ['The logo must be a PNG, JPG, WebP or SVG image (SVG without scripts).', 'Logo PNG, JPG, WebP veya SVG görsel olmalı (script içermeyen SVG).'],
  logo_too_large: ['The logo is too large (max. 1 MB after resizing).', 'Logo çok büyük (yeniden boyutlandırma sonrası en fazla 1 MB).'],
  invalid_color: ['Enter the colour as a hex code, e.g. #4F7CFF.', 'Rengi hex kodu olarak girin, ör. #4F7CFF.'],
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
  // desktop notifications
  notify_more: ['+{n} more', '+{n} diğer'],
  notify_anomalies_title: ['Unusual changes detected', 'Olağandışı değişiklikler'],
  notify_anomalies_one: ['{names} shows unusual changes in the last 2 days.', '{names} hesabında son 2 günde olağandışı değişiklikler var.'],
  notify_anomalies_many: ['{n} accounts have unusual changes in the last 2 days: {names}.', '{n} hesapta son 2 günde olağandışı değişiklikler var: {names}.'],
  notify_budget_title: ['Ad budget almost spent', 'Reklam bütçesi dolmak üzere'],
  notify_budget_one: ['{name} has spent {pct}% of its monthly budget.', '{name} aylık bütçesinin %{pct} kadarını harcadı.'],
  notify_budget_many: ['{n} ad accounts have spent at least 90% of their monthly budget: {names}.', '{n} reklam hesabı aylık bütçesinin en az %90 kadarını harcadı: {names}.'],
  notify_silent_title: ['Accounts without new posts', 'Paylaşım yapmayan hesaplar'],
  notify_silent_one: ['{names} hasn\'t posted for {days} days.', '{names} {days} gündür paylaşım yapmadı.'],
  notify_silent_many: ['{n} accounts haven\'t posted for 7+ days: {names}.', '{n} hesap 7 gün veya daha uzun süredir paylaşım yapmadı: {names}.'],
  notify_token_title: ['Meta token expiring', 'Meta token süresi doluyor'],
  notify_token_body: ['Your Meta access token expires in {days} days. Renew it in Settings to keep syncing.', 'Meta erişim token\'ınızın süresi {days} gün içinde doluyor. Senkronizasyonun sürmesi için Ayarlar\'dan yenileyin.'],
  notify_token_body_one: ['Your Meta access token expires within a day. Renew it in Settings to keep syncing.', 'Meta erişim token\'ınızın süresi bir gün içinde doluyor. Senkronizasyonun sürmesi için Ayarlar\'dan yenileyin.'],
  notify_token_expired: ['Your Meta access token has expired. Renew it in Settings to resume syncing.', 'Meta erişim token\'ınızın süresi doldu. Senkronizasyona devam etmek için Ayarlar\'dan yenileyin.'],
  // multi-platform (v1.3) — shared
  not_implemented: ['This feature is not available in this version yet.', 'Bu özellik bu sürümde henüz kullanılamıyor.'],
  invalid_metric: ['Invalid metric name.', 'Geçersiz metrik adı.'],
  invalid_platform: ['Unknown platform: {p}', 'Bilinmeyen platform: {p}'],
  token_invalid_platform: ['{platform} token invalid', '{platform} token geçersiz'],
  // Facebook Pages (chunk B)
  fb_read_insights_missing: ['The read_insights permission is missing. It is needed for Facebook Page statistics — add it in Graph API Explorer and renew the token.', 'read_insights izni eksik. Facebook Sayfası istatistikleri için gerekli — Graph API Explorer\'da ekleyip token\'ı yenileyin.'],
  fb_page_no_analyze: ['The Page "{name}" was skipped: your role on it does not include the ANALYZE task (insights access). Ask a Page admin to give you insights access.', '"{name}" Sayfası atlandı: bu Sayfadaki rolünüz ANALYZE görevini (istatistik erişimi) içermiyor. Bir Sayfa yöneticisinden istatistik erişimi isteyin.'],
  fb_page_token_missing: ['Could not get an access token for the Page "{name}". Check that you still manage this Page.', '"{name}" Sayfası için erişim token\'ı alınamadı. Bu Sayfayı hâlâ yönettiğinizi kontrol edin.'],
  fb_no_pages: ['No Facebook Pages were found for this Meta connection.', 'Bu Meta bağlantısı için Facebook Sayfası bulunamadı.'],
  fb_page_not_found: ['Facebook Page not found.', 'Facebook Sayfası bulunamadı.'],
  // Threads (chunk C)
  threads_connection: ['Threads connection', 'Threads bağlantısı'],
  threads_app_missing: ['Save the Threads App ID and App Secret first.', 'Önce Threads App ID ve App Secret kaydedin.'],
  threads_app_id_digits: ['The Threads App ID must contain digits only.', 'Threads App ID yalnızca rakamlardan oluşmalı.'],
  threads_app_secret_short: ['The Threads App Secret is missing or too short.', 'Threads App Secret eksik veya çok kısa.'],
  threads_token_or_code: ['Paste a Threads access token or an authorization code.', 'Bir Threads erişim token\'ı veya yetkilendirme kodu yapıştırın.'],
  threads_code_invalid: ['The Threads authorization code is invalid or has expired. Start the Threads login again and paste the new code.', 'Threads yetkilendirme kodu geçersiz veya süresi dolmuş. Threads girişini yeniden başlatıp yeni kodu yapıştırın.'],
  threads_token_invalid: ['The Threads token is invalid. Reconnect Threads in Settings > Connections.', 'Threads token\'ı geçersiz. Ayarlar > Bağlantılar\'dan Threads\'i yeniden bağlayın.'],
  threads_token_expired: ['Your Threads connection has expired. Reconnect it in Settings > Connections.', 'Threads bağlantınızın süresi doldu. Ayarlar > Bağlantılar\'dan yeniden bağlayın.'],
  threads_refresh_failed: ['The Threads token could not be refreshed ({detail}). Reconnect Threads in Settings > Connections if this persists.', 'Threads token\'ı yenilenemedi ({detail}). Sorun sürerse Ayarlar > Bağlantılar\'dan Threads\'i yeniden bağlayın.'],
  threads_refresh_too_early: ['A Threads token can only be refreshed when it is at least 24 hours old.', 'Threads token\'ı ancak en az 24 saatlik olduğunda yenilenebilir.'],
  threads_not_connected: ['Threads is not connected.', 'Threads bağlı değil.'],
  threads_redirect_https: ['The Threads redirect URL must start with https://', 'Threads yönlendirme adresi https:// ile başlamalı.'],
  notify_threads_token_title: ['Threads token expiring', 'Threads token süresi doluyor'],
  notify_threads_token_body: ['Your Threads access token expires in {days} days and could not be refreshed automatically. Reconnect Threads in Settings.', 'Threads erişim token\'ınızın süresi {days} gün içinde doluyor ve otomatik yenilenemedi. Ayarlar\'dan Threads\'i yeniden bağlayın.'],
  // AI assistant
  ai_off: ['The AI assistant is turned off. Enable it in Settings → AI assistant.', 'Yapay zekâ asistanı kapalı. Ayarlar → Yapay zekâ asistanı bölümünden açın.'],
  ai_no_key: ['No API key is saved for {p}. Add one in Settings → AI assistant.', '{p} için kayıtlı API anahtarı yok. Ayarlar → Yapay zekâ asistanı bölümünden ekleyin.'],
  ai_bad_provider: ['Unknown AI provider: {p}', 'Bilinmeyen yapay zekâ sağlayıcısı: {p}'],
  ai_bad_url: ['The Ollama address must be an http(s) URL, e.g. http://127.0.0.1:11434', 'Ollama adresi http(s) ile başlamalı, örn. http://127.0.0.1:11434'],
  ai_auth: ['The AI provider rejected the API key. Check it in Settings → AI assistant.', 'Yapay zekâ sağlayıcısı API anahtarını reddetti. Ayarlar → Yapay zekâ asistanı bölümünden kontrol edin.'],
  ai_rate_limit: ['The AI provider is rate limiting requests. Try again in a minute.', 'Yapay zekâ sağlayıcısı istekleri sınırlıyor. Bir dakika sonra tekrar deneyin.'],
  ai_bad_request: ['The AI provider rejected the request ({status}). {detail}', 'Yapay zekâ sağlayıcısı isteği reddetti ({status}). {detail}'],
  ai_model_not_found: ['The model "{model}" is not available for this API key.', '"{model}" modeli bu API anahtarıyla kullanılamıyor.'],
  ai_server: ['The AI provider is temporarily unavailable. Try again shortly.', 'Yapay zekâ sağlayıcısı geçici olarak kullanılamıyor. Birazdan tekrar deneyin.'],
  ai_network: ['Could not reach the AI provider. Check your internet connection (or that Ollama is running).', 'Yapay zekâ sağlayıcısına ulaşılamadı. İnternet bağlantınızı (veya Ollama\'nın çalıştığını) kontrol edin.'],
  ai_timeout: ['The AI provider took too long to answer. Try again.', 'Yapay zekâ sağlayıcısı çok geç yanıt verdi. Tekrar deneyin.'],
  ai_cancelled: ['The AI request was cancelled.', 'Yapay zekâ isteği iptal edildi.'],
  ai_refusal: ['The AI model declined to answer this request. Try again or adjust the selection.', 'Yapay zekâ modeli bu isteğe yanıt vermedi. Tekrar deneyin veya seçimi değiştirin.'],
  ai_truncated: ['The AI answer was cut off before any text was produced. Try again.', 'Yapay zekâ yanıtı metin üretilemeden kesildi. Tekrar deneyin.'],
  ai_empty: ['The AI provider returned an empty answer.', 'Yapay zekâ sağlayıcısı boş yanıt döndürdü.'],
  ai_max_steps: ['The AI assistant stopped after {n} steps without a final answer.', 'Yapay zekâ asistanı {n} adımdan sonra nihai yanıt vermeden durdu.'],
  ai_bad_input: ['Invalid AI request: {field}', 'Geçersiz yapay zekâ isteği: {field}'],
  ai_prefill: ['Internal error: the conversation cannot end with an assistant message.', 'İç hata: konuşma bir asistan mesajıyla bitemez.'],
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
