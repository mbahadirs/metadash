# Platform ekleme (sağlayıcı rehberi)

[English](../providers.md)

MetaDash her sosyal platformla bir **sağlayıcı** (provider) üzerinden konuşur: `src/main/providers/<platform>/`
altındaki bu modül, üreticinin API'sini ortak ve küçük bir biçime çevirir (profil, gönderiler, gönderi
istatistikleri, günlük istatistikler, demografi, yorumlar). Sağlayıcı katmanının üstündeki her şey (senkronizasyon,
analiz, raporlar, arayüz) platformdan bağımsızdır ve platform adları yerine **yetenekleri** (capabilities) okur.

## Mimari

```
providers/<p>/meta.js      statik, saf meta veri (etiket, kimlik doğrulama, anahtar öneki, yetenekler, KPI sözlüğü)
providers/metas.js         tüm meta'ların sıralı listesi  ─┐ capabilities.js bunlardan CAPABILITIES, PRIMARY_METRIC,
providers/index.js         sağlayıcıların sıralı listesi  ─┘ PLATFORM_LABELS, PLATFORM_AUTH, KEY_PREFIX, AUTHS üretir
providers/<p>/index.js     Provider nesnesi (API çağrıları, dönüştürme, kancalar)
sync/orchestrator.js       hesap başına bir iş, platform başına kuyruk, token çözümleme, süreçler arası kilit
sync/jobs/platformAccount.js  profil → gönderiler → gönderi istatistikleri → günlük istatistikler → türetilmiş seriler → demografi → yorumlar
```

Bir platform hem `providers/metas.js` hem `providers/index.js` içinde (aynı sırayla; bir test denetler) listelenince
*kayıtlı* olur. `enabled: false` sağlayıcılar senkronizasyonda ve `platforms:list` içinde atlanır; `contract: true`
işaretli taslaklar yine de `tests/providers.contract.test.js` tarafından denetlenir. `providers/_template/`
kopyalanabilir bir iskelettir ve hiçbir zaman kaydedilmez.

## Arayüz özeti

Tam JSDoc sözleşmesi `src/main/providers/types.js` içindedir. Kısaca:

| Üye | Zorunlu | Not |
|---|---|---|
| `meta` | evet | `meta.js` nesnesi; sağlayıcı `platform`, `auth`, `capabilities`, `primaryMetric` alanlarını da taşır |
| `accountKey(externalId)` | evet | `meta.keyPrefix + externalId`; `platformOfKey` ile geri çözülebilmeli |
| `discover(ctx)` | evet | tokenın gördüğü hesaplar → `{ items, warnings }` |
| `fetchProfile(ctx, account)` | evet | takipçi, gönderi sayısı, ad, resim |
| `fetchPosts(ctx, account, { sinceUnix })` | evet | en yeniden `sinceUnix`'e kadar; `inline` sayılar istatistiklerle birleşir |
| `fetchPostInsights` veya `fetchPostInsightsBatch` | biri | toplu = birçok gönderi için tek çağrı |
| `fetchDailyInsights(ctx, account, pencere)` | evet | API vermiyorsa `{ series: {} }` döner |
| `fetchDemographics` | `capabilities.demographics` ise | haftalık |
| `refreshToken(profile)` | çok profilli kimlik doğrulamada | `profile.refresh_ref` ile token yeniler; `invalid_grant` → kimlik hatası |
| `inbox` | `capabilities.inbox` ise (Meta dışı) | bir `InboxAdapter` (okuma / yanıt / gizleme, izinler, en uzun yanıt) |
| `reportSections`, `demo`, `computeKpi`, `maintenance` | isteğe bağlı | rapor bölümleri, demo verisi, özel KPI, bakım |
| `dailyWindow` | evet | `{ windowDays, maxLookbackDays, initialDays?, minSinceUnix?, refetchTrailingDays? }` |

## Senkronizasyon işi

`platformAccount.js` her takip edilen hesap için sırasıyla profil ve günlük anlık görüntü, son senkronizasyondan
iki gün öncesine kadar gönderiler, yenileme katmanına göre gönderi istatistikleri (tek tek ya da toplu), pencereler
hâlinde günlük istatistikler (`refetchTrailingDays` düzeltilen günleri yeniden okur), `dailySeries === 'derived'`
ise türetilmiş seriler (`analytics/derived.js`), haftalık demografi ve açıksa yorumları çalıştırır.

Hatalar: token hatası (190) o kimlik doğrulamayı geçersiz sayar (çok profillide yalnızca o kanal/hesap) ve
`token:warning` yayar; izin/parametre hataları kaydedilip iş sürer; ağ hataları çalışmayı durdurur. Yalnızca Meta
token hatası her şeyi durdurur.

## Metrik çözümleme

Üretici metrik adları değişir. Bunları `metrics.js` içinde standart adlara (`views`, `reach`, `likes`, `comments`,
`shares`, `saved`, `follower_count`, `unfollows`, `watch_time_min`, …) eşleyin; aday adlar için
`providers/shared/metricFallback.js` kullanın: kazanan `metric_resolution` tablosunda hatırlanır.

## Yetenekler: sıfır gösterme, gizle

`CAPABILITY_SCHEMA` içindeki her anahtar tanımlanmalıdır. Arayüz ve raporlar platformun ölçemediğini sıfır
göstermek yerine gizler. v2.0 ile gelen anahtarlar: `inbox`, `inboxReply` (`true | false | 'scope'`), `watchTime`,
`dailySeries` (`'native' | 'derived' | 'none'`), `experimental`.

## Kimlik doğrulama kalıpları

- **Meta token** (Instagram, Facebook) ve **Threads uzun ömürlü token**: tek profil.
- **OAuth loopback + PKCE** (YouTube, TikTok): `src/main/oauth/pkce.js`, `loopback.js` (tek seferlik
  `127.0.0.1` alıcı, sabit zamanlı state denetimi) ve `openUrl.js` (arayüzde tarayıcı, CLI'da yazdırılan adres).
  Kanal/hesap başına bir `profiles` satırı (`upsertExternalProfile`); senkronizasyon tokenı
  `await ctx.tokenForAccount(account)` ile alır.
- **Kod yapıştırma**: üretici loopback yönlendirmesini kabul etmezse statik bir HTTPS sayfası `code`/`state`
  gösterir; PKCE doğrulayıcısı makinede kaldığından kod tek başına işe yaramaz.

Tokenlar `storeToken(...)` ile şifrelenir; asla günlüğe yazılmaz veya dışa aktarılmaz.

## Hız sınırları ve kotalar

Günlük birim kotaları (YouTube Data API) `api_quota` tablosunda sayılır (`db/queries/quota.js`); kota hatası
yalnızca o sağlayıcının işlerini durduran yumuşak bir hatadır.

## fakeFetch ile test

`tests/fixtures/fakeFetch.js` istekleri sunucu adına göre (`meta`, `threads`, `google`, `tiktok`) sahte
işleyicilere yönlendirir. İşleyici `{ url, path, query, method, body }` alır, `Response` ya da `null` döner.

## Demo verisi

`demo.seed({ now, rng })` kendi demo profilini (`token_ref` `demo` ile başlar) ve hesaplarını verilen rastgele
akışla oluşturur; mevcut demo verisi değişmez.

## Çeviri

Her dil için `src/renderer/locales/<dil>/<platform>.json` ve `src/main/locales/<dil>/<platform>.json` ekleyin (en ve
tr eksiksiz), `src/renderer/locales/keys.ts` içine bir `import type` satırı ve birleşim üyesi ekleyin. Platform
adları çevrilmez.

## Tamamlanma ölçütü

- `meta.js`, kayıt satırları, sağlayıcı yöntemleri; `tests/providers.contract.test.js` geçer.
- `src/renderer/platforms/<platform>.ts` (etiket, simge, KPI kutuları, grafik) ve
  `src/renderer/routes/Settings/connections/` altında bağlantı kartı.
- `src/main/ipc/setup.<platform>.handlers.js`.
- Sahte veri, birim testleri ve bir senkronizasyon entegrasyon testi; `npm test`, `npm run typecheck`,
  `npm run i18n:check` geçer.
- `docs/<platform>-setup.md` ve `docs/tr/<platform>-setup.md`.

## Deneysel politika

API erişimi belirsiz olan sağlayıcılar `experimental: true` ile gelir; arayüz "Deneysel" rozeti gösterir. Bakımı
bırakılan bir sağlayıcı yanlış sayı göstermek yerine deneysel kalır ya da kapatılır.

## Çalışma zamanı eklentisi yok

MetaDash üçüncü taraf sağlayıcı kodunu çalışma zamanında yüklemez: sağlayıcılar çözülmüş tokenların yanında ana
süreçte çalışır. Yeni platformlar çekme isteğiyle (pull request) eklenir ve incelenir.
