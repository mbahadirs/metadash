# Mimari

[English](../architecture.md)

MetaDash tek kullanıcılı bir Electron masaüstü uygulamasıdır. Arka uç sunucusu yoktur: main process Meta Graph API'yi doğrudan çağırır, her şeyi yerel bir SQLite veritabanında saklar ve türetilmiş verileri IPC üzerinden React renderer'a sunar.

```
┌──────────────────────── Renderer (sandbox içinde) ─────────────────────────┐
│ React 18 + Vite + TS + Tailwind                                            │
│ routes/ → hooks/queries.ts (TanStack Query) → lib/api.ts call() → window.api│
└──────────────────────────────────────┬─────────────────────────────────────┘
                                       │ contextBridge (src/main/preload.cjs)
                                       │ ipcRenderer.invoke / olaylar
┌──────────────────────────────────────▼─────────────────────────────────────┐
│ Main process (Node, ES modülleri)                                          │
│ ipc/*.handlers.js ──► analytics/ ──► db/queries/ ──► better-sqlite3 (WAL)  │
│        │                                                ▲                  │
│        ├──► sync/orchestrator ──► sync/jobs ──► meta/client ──► graph.facebook.com
│        │         (p-queue)                  (yeniden deneme, hız sınırlayıcı)│
│        └──► export/ (HTML, PDF, Excel, CSV, veri taşıma)                   │
└────────────────────────────────────────────────────────────────────────────┘
```

## Süreç modeli

### Main process (`src/main`)

Giriş noktası `src/main/index.js`'dir (`package.json` içindeki `"main"`). `app.whenReady()` ile:

1. `METADASH_USER_DATA` tanımlıysa uygular, `<userData>/data.db`'yi açar ve migration'ları çalıştırır;
2. paketlenmemiş sürümde `--demo` argümanıyla başlatıldıysa ve veritabanı boşsa demo verisi üretir;
3. kayıtlı temayı uygular, IPC işleyicilerini kaydeder, pencereyi oluşturur ve zamanlayıcıyı başlatır.

Kapanışta zamanlayıcıyı durdurur ve veritabanını kapatır. `METADASH_SMOKE=1` olduğunda smoke testini de yürütür (tüm rotaları gezer, ekran görüntüsü alır, renderer konsolunda hata varsa sıfır dışı kodla çıkar).

### Preload (`src/main/preload.cjs`)

Preload betiği iki dünya arasındaki tek köprüdür. `contextBridge.exposeInMainWorld('api', …)` ile sabit, isim alanlarına bölünmüş bir API açar (`setup`, `accounts`, `tags`, `notes`, `sync`, `analytics`, `ads`, `competitors`, `export`, `system`, `db`, `settings`, `sql`, `transfer`); her metot tam olarak bir IPC kanalına karşılık gelir. Olay aboneliği (`api.on`) bir izin listesiyle sınırlıdır: `sync:progress`, `sync:done`, `token:warning`. Preload ayrıca grafik SVG'lerini canvas üzerinde PNG'ye dönüştürüp kaydedilmek üzere main process'e iletir.

### Renderer (`src/renderer`)

Vite ile `dist/renderer`'a derlenen bir React 18 tek sayfa uygulamasıdır; üretimde `loadFile` ile, geliştirmede Vite geliştirme sunucusundan (`VITE_DEV_SERVER_URL`) yüklenir. `HashRouter`, veri çekme ve önbellek için TanStack Query, arayüz durumu için Zustand (`store/app.ts`), grafikler için Recharts ve stil için Tailwind kullanır. Node.js'e, dosya sistemine, veritabanına veya token'a erişimi yoktur.

| Dizin | İçerik |
| --- | --- |
| `routes/` | Her ekran için bir klasör: Overview, Account, Content, Compare, Ads, Competitors, Reports, Presentation, Settings, Setup |
| `components/` | Yerleşim, veri tablosu, gönderi kartı/paneli, dönem seçici, Excel/PDF düğmeleri, arayüz bileşenleri |
| `charts/` | Grafik sarmalayıcı (PNG dışa aktarım), zaman serisi, ısı haritası, yaşam eğrisi, sparkline, çubuk liste |
| `hooks/` | `queries.ts` (her IPC çağrısı için TanStack Query hook'ları), `useSyncEvents.ts` (ilerleme olayları) |
| `lib/` | `api.ts` (zarf çözme), `i18n.ts`, biçimlendirme, reklam metriği tanımları, tipler |

## IPC sözleşmesi

İşleyiciler `src/main/ipc/index.js` içindeki tek bir sarmalayıcıyla kaydedilir:

```js
handle(channel, async (payload, event) => data)
// renderer'a dönen
{ ok: true, data }                                  // başarılı
{ ok: false, error: { code, message, hint } }       // hata
```

- Sarmalayıcı her istisnayı yakalar, kanal adıyla loglar ve `toUserError()` (`src/main/meta/errors.js`) ile yerelleştirilmiş, kullanıcıya yönelik bir mesaja ve isteğe bağlı bir ipucuna (örn. hangi iznin eksik olduğu) dönüştürür. Ham yığın izleri arayüze ulaşmaz.
- Renderer tarafında `src/renderer/lib/api.ts` içindeki `call()` zarfı açar ve TanStack Query'nin gösterebilmesi için `ApiCallError` fırlatır.
- İşleyiciler `src/main/ipc/*.handlers.js` altında alana göre gruplanmıştır: setup, accounts (etiketler ve notlar dahil), sync, analytics, ads, export, system (ayarlar, yedekleme/geri yükleme, veri taşıma, SQL konsolu), competitors, platforms (`platforms:list`) ve platform kurulumları (`setup.facebook.handlers.js`, `setup.threads.handlers.js`).
- Anlık olaylar (`sync:progress`, `sync:done`, `token:warning`) dahili bir `progressBus` üzerinden yayılır ve tüm pencerelere iletilir.

## Veritabanı

- **Motor:** better-sqlite3 (senkron, native). `src/main/db/index.js` içinde `journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL` ile tek bağlantı açılır.
- **Konum:** `<userData>/data.db`. `src/main/paths.js`, Electron'un `userData` çözümlemesini taklit eder; böylece komut satırı betikleri (örn. `ELECTRON_RUN_AS_NODE=1` ile çalışan `scripts/seed.js`) aynı dosyayı kullanır.
- **Migration'lar:** `src/main/db/migrations/` altında numaralı SQL dosyaları (`001_init.sql`, `002_ad_breakdowns.sql`, …). Açılışta, sayısal öneki `schema_version` tablosunda olmayan her dosya kendi transaction'ı içinde çalıştırılır ve kaydedilir. Migration'lar yalnızca ileri yönlüdür; şemayı değiştirmek için bir sonraki numarayla yeni dosya ekleyin.
- **Sorgular:** `src/main/db/queries/*.js`, alan bazında hazırlanmış sorguları sarmalar (accounts, media, stories, ads, competitors, profiles, settings, sync, tags). Küçük `q` yardımcısı `all/get/run/tx` sunar.
- **Başlıca tablolar:** `settings` (şifreli sırlar dahil JSON kodlu anahtar/değerler), `profiles`, `accounts`, `tags`/`account_tags`, `account_snapshots` (günlük takipçi sayıları), `account_insights_daily`, `account_demographics`, `media`, `media_insight_snapshots` (gönderi başına zaman serisi, yaşam eğrileri için), `media_latest`, `stories`, `comments`, `competitors`/`competitor_snapshots`, `ad_accounts`, `ad_insights_daily`, `ad_insights_breakdown`, `ad_media_links` (reklam → Instagram gönderisi), `ad_budget_overrides`, `sync_runs`, `sync_errors`, `disabled_metrics`, `metric_resolution` (Facebook/Threads için çalışan metrik adları, v1.3), `notes`.

## Meta entegrasyonu (`src/main/meta`)

| Modül | Sorumluluk |
| --- | --- |
| `client.js` | `https://graph.facebook.com/v26.0`'a karşı `graphGet` / `graphGetAll`: token'ı ekler, 30 sn zaman aşımı, `paging.next`'i izler, yeniden denenebilir kodlarda (4, 17, 32, 613; en fazla 5 deneme, 60 sn ile sınırlı ve hız sınırlayıcıyla ölçeklenen) üstel geri çekilme. Senkronizasyon başına API çağrılarını sayar. |
| `rateLimiter.js` | Her yanıttan sonra `X-App-Usage` ve `X-Business-Use-Case-Usage` başlıklarını okur. En yüksek kullanım yüzdesi bir gecikme çarpanı belirler: %80 üzerinde ×2, %95 üzerinde ×4. Temel gecikme 250 ms'dir (`METADASH_GRAPH_DELAY_MS`). |
| `errors.js` | `MetaError` (`isRetryable`, 190/102 için `isTokenError`, `isPermissionError`, `isInvalidParam`), `NetworkError` ve IPC zarfı için `toUserError()`. |
| `metricMap.js` | Medya ailesi (feed, reels, carousel, story) ve hesap düzeyi metrik adlarının tanımlandığı tek yer; adı değişen metrikler için eşlemeler (`impressions`/`plays` → `views`) dahil. |
| `auth.js` | Uzun ömürlü token dönüşümü, token denetimi, zorunlu/isteğe bağlı izinler. |
| `organic.js`, `stories.js`, `ads.js`, `competitors.js` | Profil, medya, insights, demografi, yorum, story, reklam insights'ı (hesap/kampanya/reklam seti/reklam seviyeleri ve yaş/cinsiyet/platform kırılımları) ve rakipler için Business Discovery veri çekicileri. |

Hesap keşfi, `/me/accounts` (kişisel Sayfa rolleri) ile Business Manager'daki `owned_pages` / `client_pages` ve `owned_instagram_accounts` / `client_instagram_accounts` kaynaklarını (`business_management` gerekir) birleştirir. Taranamayan kaynaklar Kurulum sihirbazında uyarı olarak gösterilir.

Meta bir metriği 100 hata koduyla reddettiğinde metrik sonraki isteklerden çıkarılır, `disabled_metrics` tablosuna yazılır ve Ayarlar'da listelenir; oradan yeniden etkinleştirilebilir.

## Sağlayıcılar (`src/main/providers`)

v1.3'ten itibaren her sosyal platform tek bir arayüzün arkasındaki bir *sağlayıcıdır*; böylece senkronizasyon işi, analitik ve arayüz platformdan bağımsız kalır. Ortak Meta altyapısı (client, hatalar, hız sınırlayıcı, auth, reklamlar, rakipler) `src/main/meta` içinde kalır; `meta/organic.js`, `meta/stories.js` ve `meta/metricMap.js` Instagram sağlayıcısını yeniden dışa aktaran ara dosyalardır.

| Modül | Sorumluluk |
| --- | --- |
| `index.js` | Kayıt: `listProviders()` (etkin sağlayıcılar, Instagram → Facebook → Threads sırasıyla), `getProvider(platform)`. Taslak sağlayıcılar (`{ platform, enabled: false }`) atlanır. |
| `types.js` | JSDoc sözleşmesi (`Provider`, `SyncContext`, `Post`, …): `discover`, `prepare?`, `fetchProfile`, `fetchPosts`, `fetchPostInsights`, `fetchDailyInsights`, `fetchDemographics?`, `fetchComments?`, `skipInsights?`, `maintenance?`, `dailyWindow`, `concurrency`, `auth` (`meta` / `threads`). |
| `capabilities.js` | Platform yetenekleri (erişim, kaydetme oranı, hikâyeler, demografi, rakipler, yorumlar, reklamlar), birincil metrik (`reach`, Threads için `views`) ve hesap anahtarı yardımcıları. `platforms:list` ile renderer'a açılır. |
| `shared/insights.js` | Genel günlük `/insights` döngüsü (önce zaman serisi, yalnızca `total_value` sunulan metrikler gün gün, desteklenmeyenler düşürülür). |
| `shared/metricFallback.js` | Kanonik metrik → aday API adları; çalışan ad `metric_resolution` tablosuna yazılır, tüm adayları biten metrik desteklenmiyor olarak işaretlenir. |
| `shared/metaPages.js` | Instagram ve Facebook keşfinin paylaştığı Facebook Sayfası taraması (`/me/accounts` + Business Manager sayfaları). |
| `shared/tiers.js` | Gönderi istatistiği yenileme kademeleri (`needsRefresh`). |
| `instagram/` | Instagram sağlayıcısı (`api.js`, `stories.js`, `metrics.js`). `facebook/` ve `threads/` diğer sağlayıcıları barındırır. |

Tüm platformların hesapları `accounts` tablosundadır; `ig_id` sütunu *hesap anahtarıdır* (ham Instagram kimliği, `fb-<pageId>`, `th-<userId>`), `external_id` ise ham API kimliğidir. `profiles.platform` Meta ve Threads bağlantılarını ayırır.

## Senkronizasyon

### Orkestratör (`src/main/sync/orchestrator.js`)

`runSync({ scope, igIds, platforms })`, `scope` = `full | organic | stories | ads | competitors`:

1. Takip edilen hesaplardan, takip edilen reklam hesaplarından ve rakiplerden iş listesini oluşturur (isteğe bağlı olarak `igIds` ile daraltılır).
2. Bir `sync_runs` satırı açar ve her hesap için bir işi ayrı [p-queue](https://github.com/sindresorhus/p-queue) kuyruklarına ekler:

   | Kuyruk | Eşzamanlılık |
   | --- | --- |
   | organic (platform başına bir kuyruk, ilk kullanımda oluşturulur) | sağlayıcının `concurrency` değeri (Instagram 2) |
   | stories (yalnızca Instagram) | 2 |
   | ads | 2 |
   | competitors | 1 |

3. `sync:progress` (aşama, geçerli hesap, tamamlanan/toplam, API çağrısı) ve sonunda `sync:done` olaylarını yayar. Çalışma `ok`, `partial` (bazı işlerde hata; `sync_errors`'a yazılır) veya `failed` olarak biter.
4. Meta token hatası (190/102) tüm çalışmayı durdurur ve `platform: 'meta'` ile `token:warning` yayar; Threads token hatası yalnızca kalan Threads işlerini atlar (`platform: 'threads'` ile `token:warning`, `sync:done.invalidAuth`). Ağ hatası çalışmayı iptal eder, mevcut veriler olduğu gibi kalır. `cancelSync()` bir `AbortController` ile iptal eder ve kuyrukları boşaltır.

Aynı anda yalnızca bir senkronizasyon çalışır. Etkin profil demo profiliyse `sync/demo.js` aşamaları ağ çağrısı yapmadan simüle eder ve demo veri kümesini bir gün ileri alır.

### İşler (`src/main/sync/jobs`)

- **Organik hesap** (`platformAccount.js`, sağlayıcılardan bağımsız; `organicAccount.js` Instagram sarmalayıcısıdır): profil ve takipçi anlık görüntüsü → medya listesi (artımlı: son senkronizasyondan iki gün öncesinden, ilk senkronizasyonda `mediaLookbackDays`) → **yenileme kademesine** göre medya insights → günlük hesap insights → demografi (haftalık) → yorumlar (isteğe bağlı). Açıklamalar uzunluk, hashtag, bahsetme ve emoji açısından analiz edilir (`sync/caption.js`).
- **Yenileme kademeleri:** 48 saatten genç gönderiler her senkronizasyonda yenilenir; 7 güne kadar olanlar her `recent` saatte (varsayılan 24); 30 güne kadar olanlar her `month` saatte (168); daha eskiler her `old` saatte (720). Ayarlar'dan değiştirilebilir.
- **Story'ler:** etkin story'ler ve insights'ları.
- **Reklamlar:** hesap, kampanya, reklam seti ve reklam seviyelerinde insights ile yaş, cinsiyet ve platform kırılımları; son kayıtlı tarihten üç gün önceden başlar (ilk senkronizasyonda `adsLookbackDays`, varsayılan 90). Reklamlar tanıttıkları Instagram gönderileriyle eşleştirilir.
- **Rakipler:** Business Discovery ile herkese açık sayılar.

### Zamanlayıcı (`src/main/sync/scheduler.js`)

Her döngü önce tüm sağlayıcıların `maintenance()` kancasını çalıştırır (ör. Threads token yenileme).

Uygulama açıkken 15 dakikalık bir döngü; son story senkronizasyonu `storyIntervalHours`'tan (varsayılan 4, `0` kapatır) eskiyse story senkronizasyonu, `autoSyncDaily` açıksa günde bir tam senkronizasyon çalıştırır. Arayüz ayrıca son başarılı senkronizasyon 20 saatten eskiyse güncelleme önerir.

## Analitik (`src/main/analytics`)

Tüm analizler main process'te SQLite'tan hesaplanır ve IPC ile döndürülür.

| Modül | Amaç |
| --- | --- |
| `engagement.js` | Etkileşim (beğeni + yorum + kaydetme + paylaşım), takipçiye (varsayılan) ve erişime göre etkileşim oranı, kaydetme oranı; `media_latest` tablosunu doldurur. |
| `health.js` | 0–100 sağlık skoru: büyüme %30 + etkileşim %30 + düzenlilik %20 + yanıt oranı %20; her biri portföy içindeki yüzdelik dilime göre normalize edilir. |
| `besttime.js` | Ortalama etkileşim oranının 7 × 24 gün/saat matrisi; 3'ten az gönderili hücreler işaretlenir. |
| `lifecycle.js` | `media_insight_snapshots`'tan gönderi yaşam eğrileri (saat cinsinden yaş ve nihai değerin payı) ve %80'e ulaşma süresi. |
| `anomaly.js` | Son 30 günlük ortalamadan ±2σ sapan günlük değerleri işaretler. |
| `portfolio.js`, `account.js`, `compare.js`, `content.js` | Genel Bakış, Hesap, Karşılaştır ve İçerik ekranları için toplulaştırmalar. |
| `paid.js`, `blended.js`, `budget.js` | Ortak ücretli metrik alanları, organik + ücretli seriler, aylık bütçe temposu, tahminler ve bütçe dağılımı. |
| `weeklyDigest.js` | Otomatik haftalık değişim özeti metni. |

## Dışa aktarım (`src/main/export`)

| Modül | Çıktı |
| --- | --- |
| `htmlReport.js` | Rapor şablonları (müşteri aylık/haftalık/özel, portföy, kampanya, haftalık özet, seçilen gönderiler) tek dosyalık HTML olarak üretilir. Grafikler main process'te satır içi SVG olarak oluşturulur (`svgCharts.js`); isteğe bağlı logo data URL olarak gömülür, raporlar çevrimdışı çalışır. |
| `pdf.js` | Aynı HTML'i gizli, sandbox'lı bir `BrowserWindow`'da açıp `printToPDF` (A4) çağırır. |
| `xlsxReport.js`, `xlsx.js` | exceljs ile çok sayfalı Excel çalışma kitapları (özet, günlük seri, gönderiler, tür/hashtag, story, demografi, reklamlar). |
| `tablePdf.js` | Ekrandaki herhangi bir tabloyu yatay A4 PDF'e çevirir. |
| `reportI18n.js` | Arayüz dilinden bağımsız, `[tr, en]` çiftleri hâlinde rapor metinleri. |
| `csv.js` | Hazır CSV dışa aktarımları ve salt okunur SQL konsolu. Sorgular `SELECT`/`WITH` ile başlamalıdır; yazma/DDL anahtar kelimeleri (`insert`, `update`, `delete`, `drop`, `alter`, `create`, `attach`, `pragma`, …) reddedilir. |

## Yedekleme, geri yükleme ve veri taşıma

- **Yedekleme / geri yükleme** (`db:backup`, `db:restore`): better-sqlite3'ün çevrimiçi yedekleme özelliğiyle ham SQLite kopyası. Geri yükleme SQLite başlığını doğrular, mevcut veritabanının `data.db.pre-restore-<zaman damgası>` kopyasını saklar, ardından dosyayı değiştirip yeniden açar. Ham yedekteki sırlar yalnızca aynı makinede okunabilir.
- **Veri taşıma** (`export/transfer.js`, `.metadash` dosyaları) her şeyi başka bir bilgisayara taşır:
  - *Dışa aktarma:* geçici dosyaya çevrimiçi yedek alır, 1.0 öncesi sürümlerden kalan ayarları siler ve her sırrı ya kullanıcı parolasıyla yeniden şifreler (scrypt N=16384 → AES-256-GCM, `pp:` öneki) ya da parola verilmediyse çıkarır. Bir `transfer.meta` satırı ekler, VACUUM yapar ve dosyayı yazar.
  - *İnceleme:* dosyayı salt okunur açar; sayıları, şema sürümünü ve parola gerekip gerekmediğini bildirir.
  - *İçe aktarma:* parolayı doğrular, `pre-import` kopyası saklar, veritabanını değiştirir, bekleyen migration'ları çalıştırır ve sırları yerel makine anahtarıyla yeniden şifreler. Başka makine için şifrelenmiş sırlar atılır.

## Yapılandırma ve sırlar (`src/main/config`)

- `store.js`, `settings` tablosunda saklanan varsayılanları tutar (`theme`, `lang` = `en`, `autoSyncDaily`, `storyIntervalHours`, `refreshTiers`, `mediaLookbackDays`, …). Renderer yalnızca bilinen anahtarlara veya `ui.` önekli anahtarlara yazabilir.
- Sırlar (Meta token'ı, App Secret) **AES-256-GCM** ile şifrelenir. Anahtar `SHA-256("metadash-store-v1|" + machineId)`'dir; `machine.js`, `machineId`'yi donanım UUID'sinin (macOS), `MachineGuid`'in (Windows) veya `/etc/machine-id`'nin (Linux) tuzlu SHA-256'sı olarak türetir; bunlar yoksa bilgisayar adı + CPU modeli + bellek boyutuna düşer. Electron'un `safeStorage`'ı bilinçli olarak kullanılmaz; macOS'ta Anahtar Zinciri'ni kullanır ve imzasız ya da yeniden imzalanmış sürümlerde oturum parolası ister.
- Bu yöntem kopyalanan bir veritabanı dosyasındaki sırları korur. Aynı makinede kullanıcı hesabınıza erişimi olan birine karşı koruma sağlamaz.

## Uluslararasılaştırma

| Katman | Dosya | Biçim |
| --- | --- | --- |
| Renderer arayüzü | `src/renderer/lib/i18n.ts` | `key: [tr, en]` |
| Raporlar | `src/main/export/reportI18n.js` | `key: [tr, en]` |
| Main process mesajları (hatalar, diyaloglar) | `src/main/i18n.js` | `key: [en, tr]` |

Arayüz dili varsayılan olarak İngilizcedir ve `lang` ayarında saklanır. Raporlar kendi `lang` parametresini alır.

## Güvenlik modeli

- **Pencere:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Renderer yalnızca preload API'sini görür.
- **Content Security Policy** (`src/renderer/index.html`): `default-src 'self'`, `script-src 'self'`; görsellere `https:` ve `data:` kaynaklarından izin verilir (Meta CDN küçük resimleri ve profil fotoğrafları); `connect-src` yalnızca yerel Vite geliştirme sunucusuna izin verir.
- **Gezinme:** `setWindowOpenHandler` tüm yeni pencereleri reddeder; `http(s)` bağlantıları sistem tarayıcısında açılır. `system:openExternal` http(s) dışındaki adresleri reddeder.
- **Ağ:** yalnızca main process istek yapar: `graph.facebook.com`'a ve kurulu sürümlerde güncelleme denetimi için GitHub'a (`api.github.com` / `github.com` sürüm indirmeleri); bu denetim Ayarlar'dan kapatılabilir. Telemetri yoktur.
- **SQL konsolu:** yalnızca salt okunur ifadeler (bkz. Dışa aktarım).
- **Electron fuse'ları** (`scripts/afterPack.cjs`, electron-builder tarafından paketlenmiş uygulamaya uygulanır):

  | Fuse | Ayar | Etki |
  | --- | --- | --- |
  | `RunAsNode` | kapalı | `ELECTRON_RUN_AS_NODE` uygulamayı düz bir Node çalışma ortamına çeviremez |
  | `EnableNodeOptionsEnvironmentVariable` | kapalı | `NODE_OPTIONS` yok sayılır |
  | `EnableNodeCliInspectArguments` | kapalı | `--inspect` hata ayıklama bayrakları yok sayılır |
  | `OnlyLoadAppFromAsar` | açık | uygulama paketlenmemiş bir klasörle değiştirilemez |
  | `EnableEmbeddedAsarIntegrityValidation` | açık (macOS) | değiştirilmiş bir `app.asar` açılmaz |
  | `EnableCookieEncryption` | kapalı | macOS'ta Anahtar Zinciri parola istemini önler; çerezlerde kimlik bilgisi tutulmaz |
  | `GrantFileProtocolExtraPrivileges` | açık | asar içinden `loadFile()` için gereklidir |

- **Paketleme:** `asar: true`; yalnızca `better-sqlite3` paket dışında tutulur. macOS paketleri hardened runtime ve `resources/entitlements.mac.plist` kullanır.

## Test

- **Birim ve entegrasyon testleri** (`tests/`, Vitest, `environment: node`), native modül ABI'si eşleşsin diye Electron'un Node'u altında (`ELECTRON_RUN_AS_NODE=1`) çalışır. `sync.integration.test.js`, sahte bir Graph API'ye karşı tam bir senkronizasyon çalıştırır.
- **Tip kontrolü:** renderer için `tsc --noEmit`.
- **Smoke testi:** `npm run smoke` gerçek uygulamayı başlatır, tüm rotaları gezer ve renderer hatalarında başarısız olur.
