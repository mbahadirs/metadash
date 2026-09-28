# MetaDash

[English](README.md)

Çok sayıda hesabı birlikte yöneten ekipler için Instagram hesapları ve Meta reklamları üzerine, verisini yerelde tutan masaüstü analitik uygulaması.

MetaDash, yönettiğiniz tüm hesapların organik Instagram verisini (Graph API) ve Meta reklam verisini çeker, yerel bir SQLite veritabanında saklar ve bunları portföy özetlerine, hesap bazlı analizlere, karşılaştırmalara, rakip takibine, bütçe temposuna, müşteriye hazır raporlara (HTML, PDF, Excel) ve uygulama içi sunumlara dönüştürür. Sunucu yoktur, kayıt olmanız gerekmez: uygulama kendi Meta uygulamanız ve erişim token'ınızla doğrudan Meta Graph API'ye bağlanır.

- **Platformlar:** macOS (Apple Silicon ve Intel), Windows, Linux
- **Teknoloji:** Electron 33, React 18, Vite, TypeScript, Tailwind CSS, better-sqlite3
- **Lisans:** [MIT](LICENSE)

## İçindekiler

- [Ekran görüntüleri](#ekran-görüntüleri)
- [Özellikler](#özellikler)
- [Uygulamayı indirme ve kurma](#uygulamayı-indirme-ve-kurma)
- [Hızlı başlangıç](#hızlı-başlangıç)
- [Dil](#dil)
- [Veri ve gizlilik](#veri-ve-gizlilik)
- [Geliştirme](#geliştirme)
- [Proje yapısı](#proje-yapısı)
- [Mimari](#mimari)
- [Katkıda bulunma](#katkıda-bulunma)
- [Lisans](#lisans)

## Ekran görüntüleri

Ekran görüntüleri [`docs/images/`](docs/images/) klasörüne eklenecek.

<!--
![Genel Bakış](docs/images/overview.png)
![Hesap ayrıntısı](docs/images/account.png)
![Reklamlar ve bütçe takibi](docs/images/ads.png)
![Raporlar](docs/images/reports.png)
![Sunum](docs/images/presentation.png)
-->

## Özellikler

| Bölüm | Neler var |
| --- | --- |
| **Genel Bakış** | Takip edilen tüm hesapların portföy tablosu: takipçi ve net değişim, erişim, etkileşim oranı, kaydetme oranı, gönderi sayısı, sağlık skoru, organik ve ücretli erişim, reklam harcaması. Arama, etiket filtresi ve lig tablosu. |
| **Hesap ayrıntısı** | Takipçi ve erişim/etkileşim grafikleri, önceki döneme göre KPI'lar, sağlık skoru kırılımı, gönderi ızgarası ve tablosu, story'ler (tamamlanma ve çıkış oranı), kitle demografisi (şehir, ülke, yaş ve cinsiyet), en iyi paylaşım zamanı ısı haritası, gönderi yaşam eğrileri ("etkileşimin %80'i ilk N saatte"), bağlı reklam hesabı metrikleri ve organik + ücretli görünüm. |
| **İçerik** | Filtreli (tür, minimum erişim, yalnızca reklamlı, arama) ve isteğe bağlı reklam metriği sütunlu, hesaplar arası gönderi tablosu; içerik analizi (tür kırılımı, hashtag performansı, en iyi gönderiler); elle seçilen gönderiler için rapor sepeti. Her gönderi; yaşam eğrisi, reklam satırları ve notları içeren bir panelde açılır. |
| **Karşılaştır** | Seçilen hesapların yan yana karşılaştırması ve gönderi–gönderi karşılaştırması. |
| **Reklamlar** | Tutarlı tek bir metrik setiyle reklam hesabı tablosu (gösterim, sonuç ve sonuç başına ücret, bütçe, harcama, erişim, sıklık, CPC, CTR, CPM, gönderi/sayfa etkileşimi ve maliyetleri). Kampanya, reklam seti ve reklam seviyeleri; yaş, cinsiyet ve platform kırılımları; organik + ücretli birleşik görünüm; reklamların tanıttıkları Instagram gönderileriyle eşleştirilmesi. |
| **Bütçe takibi** | Reklam hesabı başına aylık bütçe; takvim ayına göre tempo, kalan bütçe, gereken günlük harcama, bugün / dün / son 7 gün, ay sonu tahmini ve tempo altındaki hesaplar için "boost adayları" (henüz reklamı olmayan son gönderiler). Bütçe dağılımı ağacı, bütçeyi kampanya → reklam seti → reklam şeklinde paylaştırır; elle geçersiz kılınabilir. MetaDash, Meta tarafında hiçbir şeyi değiştirmez. |
| **Rakipler** | Herkese açık rakip hesapları Business Discovery ile takip edin: takipçi, büyüme, paylaşım sıklığı, ortalama beğeni ve yorum (rakipler için erişim verisi yoktur). |
| **Raporlar** | Şablonlar: aylık müşteri raporu, haftalık müşteri raporu, özel tarih aralığı, portföy özeti, kampanya raporu (organik + ücretli), haftalık değişim özeti, seçilen gönderiler raporu. Bölümleri seçin, logo ve değerlendirme ekleyin, rapor dilini belirleyin, ön ayar kaydedin. Tek dosyalık HTML (grafikler SVG olarak gömülü, çevrimdışı çalışır), PDF veya çok sayfalı Excel olarak dışa aktarın. |
| **Sunum** | Verilerinizden üretilen tam ekran slayt destesi (kapak, KPI'lar, büyüme, içerik, en iyi gönderiler, öne çıkan gönderi, hashtag'ler, en iyi zaman, reklamlar, kampanyalar, kırılımlar, reklamlı gönderiler, rapor sepeti, sonraki adımlar). Ok tuşlarıyla ilerleme, `F` tam ekran, `Esc` çıkış. |
| **Her yerde dışa aktarım** | Her veri tablosu `.xlsx` veya yatay A4 PDF, her grafik PNG olarak kaydedilebilir. |
| **Senkronizasyon** | Tür bazlı kuyruklarla artımlı senkronizasyon, Meta kullanım başlıkları yükseldikçe otomatik yavaşlama, gönderi yaşına göre kademeli insights yenileme, belirli aralıklarla story yenileme, uygulama açıkken isteğe bağlı günlük otomatik güncelleme. |
| **Ayarlar ve veri** | Hesap yönetimi (müşteri adı, renk, etiketler, takip), reklam hesabı eşleme, token durumu ve yenileme, senkronizasyon geçmişi ve hataları, desteklenmeyen metrik yönetimi, veritabanı yedekleme ve geri yükleme, bilgisayarlar arası tam veri taşıma (`.metadash` dosyaları), CSV dışa aktarım, salt okunur SQL konsolu, koyu/açık tema, İngilizce/Türkçe arayüz. |

## Uygulamayı indirme ve kurma

En güncel kurulum dosyasını **[GitHub Releases](https://github.com/mbahadirs/metadash/releases)** sayfasından indirin.

| Platform | Dosya |
| --- | --- |
| macOS, Apple Silicon | `MetaDash-<sürüm>-mac-arm64.dmg` |
| macOS, Intel | `MetaDash-<sürüm>-mac-x64.dmg` |
| Windows x64 | `MetaDash-Setup-<sürüm>.exe` (kurulum sihirbazı; kurulum klasörü seçilebilir) |
| Linux x64 | `MetaDash-<sürüm>-linux-<mimari>.AppImage` veya `.deb` |

### İmzasız paketler

Sürüm paketleri yalnızca depoda imzalama sırları tanımlıysa kod imzalı olur; bu yüzden işletim sisteminiz ilk açılışta uyarı verebilir.

- **macOS** ("MetaDash doğrulanamadı" veya "hasarlı"): uygulamayı Uygulamalar klasörüne taşıyın, ardından ya şunu çalıştırın

  ```bash
  xattr -cr /Applications/MetaDash.app
  ```

  ya da uygulamayı bir kez açmayı deneyip **Sistem Ayarları → Gizlilik ve Güvenlik** bölümünde **Yine de Aç**'a tıklayın.
- **Windows** (SmartScreen "Windows bilgisayarınızı korudu"): **Ek bilgi → Yine de çalıştır**'a tıklayın.
- **Linux:** AppImage'ı çalıştırılabilir yapın (`chmod +x MetaDash-*.AppImage`) ve çalıştırın ya da Debian paketini `sudo apt install ./MetaDash-*.deb` ile kurun.

## Hızlı başlangıç

1. Development modunda bir **Meta uygulaması oluşturun** ve gerekli izinleri ekleyin. Graph API Explorer ve sorun giderme dahil tüm adımlar **[docs/tr/meta-app-setup.md](docs/tr/meta-app-setup.md)** dosyasındadır. Kurulum sihirbazındaki kılavuz düğmesi aynı belgeyi açar.
2. MetaDash'te **Kurulum sihirbazını** tamamlayın:
   1. **Karşılama**
   2. **Meta uygulaması** – App ID ve App Secret'ı yapıştırın.
   3. **Token** – Graph API Explorer'dan aldığınız kullanıcı token'ını yapıştırın. MetaDash bunu 60 günlük uzun ömürlü token'a çevirir ve verilen izinleri gösterir.
   4. **Hesap seçimi** – takip edilecek Instagram hesaplarını seçin; müşteri adlarını ve etiketleri girin.
   5. **Reklam hesapları** – isteğe bağlı olarak her reklam hesabını bir Instagram hesabıyla eşleyin.
   6. **İlk senkronizasyon**
3. Verileri tazelemek için üst çubuktaki **Güncelle** düğmesini kullanın ya da **Ayarlar**'da günlük otomatik güncellemeyi açın.

İzinler: `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`, `ads_read` (zorunlu); `business_management` (Sayfalar veya reklam hesapları bir Business Manager'daysa gerekir) ve `instagram_manage_comments` (yorum modülü) isteğe bağlıdır.

## Dil

Arayüz varsayılan olarak **İngilizce**dir. **Settings → Theme · Language** (Ayarlar → Tema · Dil) bölümünden **Türkçe**'ye geçebilirsiniz. Raporların kendi dil seçicisi vardır; İngilizce arayüzden Türkçe rapor üretebilirsiniz, tersi de mümkündür.

## Veri ve gizlilik

- **Her şey bilgisayarınızda kalır.** Tüm veriler, kullanıcı veri dizinindeki tek bir SQLite veritabanında (`data.db`, WAL modu) tutulur:

  | İşletim sistemi | Konum |
  | --- | --- |
  | macOS | `~/Library/Application Support/MetaDash/` |
  | Windows | `%APPDATA%\MetaDash\` |
  | Linux | `$XDG_CONFIG_HOME/MetaDash/` (genellikle `~/.config/MetaDash/`) |

- **Sırlar şifreli saklanır.** Meta erişim token'ı ve App Secret, makine kimliğinden (macOS'ta donanım UUID'si, Windows'ta `MachineGuid`, Linux'ta `/etc/machine-id`) türetilen bir anahtarla AES-256-GCM kullanılarak şifrelenir. Kopyalanan bir veritabanı başka bilgisayarda bu sırları çözemez. Yeni bir makineye geçmek için **Ayarlar → Veri taşıma**'yı kullanın; sırlar sizin belirlediğiniz bir parolayla yeniden şifrelenerek taşınabilir.
- **Telemetri, analitik, güncelleme denetimi ya da MetaDash sunucusu yoktur.** Main process yalnızca `https://graph.facebook.com` adresine istek yapar (API çağrıları ve çevrimiçi kontrolü). Profil fotoğrafları ve gönderi küçük resimleri, API'nin döndürdüğü Meta CDN adreslerinden gösterilir.
- "Instagram'da aç" gibi bağlantılar varsayılan tarayıcınızda açılır.

## Geliştirme

### Gereksinimler

- Node.js 20 veya üzeri, npm
- `better-sqlite3`'ün Electron sürümünüz için derlenmesi gerekirse bir C/C++ derleme ortamı (macOS'ta Xcode Command Line Tools, Windows'ta Visual Studio Build Tools, Linux'ta `build-essential` ve `python3`)

### Kurulum

```bash
git clone https://github.com/mbahadirs/metadash.git
cd metadash
npm install        # postinstall, better-sqlite3'ü Electron için yeniden derler
npm run dev        # Vite geliştirme sunucusu + Electron, canlı yeniden yükleme
```

`npm start`, renderer'ı bir kez derleyip Electron'u geliştirme sunucusu olmadan açar.

### Demo verisi

Arayüz üzerinde çalışmak için Meta uygulaması gerekmez. Geliştirme sürümleri deterministik bir demo veri kümesi üretebilir: 120 günlük veriyle 40 hesap; takipçi anlık görüntüleri, günlük insights, gönderiler ve yaşam eğrisi anlık görüntüleri, story'ler, yorumlar, demografi, 16 reklam hesabı (kampanyalar, reklam setleri, reklamlar ve kırılımlar), rakipler ve senkronizasyon geçmişi.

```bash
npm run seed          # demo verisini kullanıcı veri dizinine yazar (zaten varsa atlar)
npm run seed:reset    # demo verisini silip yeniden üretir
```

Demo verisi için diğer yollar:

- Kurulum sihirbazında veya Ayarlar'da **Demo verisi yükle**'ye tıklayın.
- Electron'u `--demo` ile başlatın; boş veritabanı açılışta doldurulur. Örneğin bir terminalde `npx vite`, diğerinde `npm run dev:electron -- --demo` çalıştırın.

Demo verisiyle **Güncelle** Meta API'yi çağırmaz; senkronizasyon aşamalarını simüle eder ve veri kümesini bir gün ileri alır. Paketlenmiş sürümlerde demo verisi kapalıdır. Gerçek hesaplara geçmek için **Ayarlar → Tüm verileri sil**'i kullanıp Kurulum sihirbazını çalıştırın.

### Ortam değişkenleri

| Değişken | Amaç |
| --- | --- |
| `METADASH_USER_DATA` | Kullanıcı veri dizinini (`data.db` konumu) değiştirir. Geliştirme verisini ayrı tutmak için kullanışlıdır. `npm run seed` de bunu dikkate alır. |
| `VITE_DEV_SERVER_URL` | Renderer'ı `dist/renderer` yerine bir geliştirme sunucusundan yükler (`npm run dev` ayarlar). |
| `METADASH_GRAPH_DELAY_MS` | Kuyruktaki Graph API istekleri arasındaki temel gecikme, ms (varsayılan `250`). |
| `METADASH_SMOKE` | `1` smoke testini çalıştırır: tüm ekranları gezer, ekran görüntüsü kaydeder, renderer hatasında sıfır dışı kodla çıkar (`npm run smoke` ayarlar). |
| `METADASH_SMOKE_DIR` | Smoke testi ekran görüntüsü dizini (varsayılan `<userData>/smoke`). |
| `METADASH_SMOKE_ROUTES` | Varsayılan yerine gezilecek, virgülle ayrılmış hash rotaları. |
| `METADASH_SMOKE_THEME` | `light` veya `dark`; ekran görüntüleri için temayı sabitler. |
| `METADASH_SMOKE_SYNC` | `1` smoke testinin sonunda bir senkronizasyon da çalıştırır (demo verisiyle kullanın). |

### Test

```bash
npm test            # Vitest; native better-sqlite3 derlemesi eşleşsin diye Electron'un Node'u altında çalışır
npm run typecheck   # renderer için TypeScript kontrolü
npm run smoke       # renderer'ı derler ve gerçek bir Electron penceresinde tüm ekranları gezer
```

Test paketi analitiği, veritabanı katmanını, Meta hata işleme ve metrik eşlemesini, organik veri ayrıştırmayı ve sahte bir Graph API'ye karşı uçtan uca senkronizasyonu kapsar (`tests/sync.integration.test.js`: token dönüşümü, hesap keşfi, sayfalama, desteklenmeyen metriklerin düşürülmesi, story'ler, reklamlar, reklam–gönderi eşleştirmesi, 190 hata kodunda durma).

Smoke testinden önce demo verisi yükleyin (`npm run seed`).

### Kurulum paketleri oluşturma

```bash
npm run build:mac     # dmg + zip, arm64 ve x64
npm run build:win     # NSIS kurulum sihirbazı, x64
npm run build:linux   # AppImage + deb, x64
npm run build         # hepsi
```

Çıktılar `release/` klasörüne yazılır. Her derleme betiği sonunda `better-sqlite3`'ü Electron için yeniden derler; böylece `npm run dev` çalışmaya devam eder. Native modüller nedeniyle çapraz derleme güvenilir değildir; her platformu kendi işletim sisteminde derleyin (sürüm iş akışı da bunu yapar).

İsteğe bağlı kod imzalama: electron-builder, macOS Anahtar Zinciri'ndeki "Developer ID Application" sertifikasını ya da `CSC_LINK` / `CSC_KEY_PASSWORD` değişkenlerini otomatik kullanır. Noter onaylı macOS paketi için `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` ve `APPLE_TEAM_ID` değişkenlerini tanımlayıp `npm run build:mac:notarized` çalıştırın.

### Sürüm yayınlama

Sürümler GitHub Actions ile derlenir ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

1. [CHANGELOG.md](CHANGELOG.md) dosyasını güncelleyip commit'leyin.
2. Sürümü artırın: `npm version patch` (veya `minor` / `major`). Bu komut `package.json`'ı günceller, commit oluşturur ve `vX.Y.Z` etiketini ekler.
3. Commit'i ve etiketi gönderin: `git push --follow-tags`.
4. İş akışı etiketin `package.json` sürümüyle eşleştiğini kontrol eder, testleri çalıştırır, macOS, Windows ve Linux üzerinde derler ve kurulum dosyalarını ekleyerek bir GitHub Release yayınlar.

Depoda imzalama sırları (`CSC_LINK`, `CSC_KEY_PASSWORD`; noter onayı için ayrıca `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`) tanımlıysa paketler imzalanır; aksi hâlde imzasız olur. İş akışı, mevcut bir etiketi yeniden derlemek için elle de başlatılabilir.

## Proje yapısı

```
src/
  main/                  Electron main process (ES modülleri)
    index.js             uygulama yaşam döngüsü, pencere, smoke testi
    preload.cjs          contextBridge: window.api'yi renderer'a açar
    i18n.js              main process kullanıcı mesajları
    ipc/                 alana göre gruplanmış IPC işleyicileri
    meta/                Graph API istemcisi, hız sınırlayıcı, hatalar, metrik eşlemesi, auth,
                         organik / story / reklam / rakip veri çekicileri
    sync/                orkestratör (p-queue), işler, zamanlayıcı, ilerleme olayları, demo senkronizasyonu
    db/                  better-sqlite3 bağlantısı, numaralı SQL migration'ları, sorgu modülleri
    analytics/           türetilmiş metrikler: sağlık, etkileşim, en iyi zaman, yaşam eğrisi, anomali, bütçe, ...
    export/              HTML / PDF / Excel raporları, tablo dışa aktarımı, CSV, veri taşıma
    config/              ayar deposu, sır şifreleme, makine kimliği
    seed/                deterministik demo veri üreticisi
  renderer/              React 18 + Vite + TypeScript + Tailwind
    routes/              Overview, Account, Content, Compare, Ads, Competitors,
                         Reports, Presentation, Settings, Setup
    components/ charts/ hooks/ store/ lib/ styles/
scripts/
  seed.js                demo verisi komut satırı aracı
  afterPack.cjs          paketlenmiş uygulamada Electron fuse'larını ayarlar
tests/                   Vitest test paketleri
docs/                    Meta uygulaması kurulum kılavuzu ve mimari (Türkçeleri docs/tr/ altında)
resources/               derleme kaynakları (macOS entitlement'ları, kurulum ekran görüntüleri)
electron-builder.yml     paketleme yapılandırması
```

## Mimari

Renderer'ın Node.js erişimi yoktur. Main process ile yalnızca preload betiğinin açtığı `window.api` üzerinden konuşur ve her çağrı `{ ok: true, data }` ya da `{ ok: false, error: { code, message, hint } }` döndürür. Veritabanı, Meta token'ı ve tüm ağ erişimi main process'tedir. Senkronizasyon main process'te, tür bazlı kuyruklar ve Meta kullanım başlıklarına göre çalışan bir hız sınırlayıcı üzerinden yürür.

Ayrıntılar için **[docs/tr/architecture.md](docs/tr/architecture.md)**: IPC, veritabanı ve migration'lar, senkronizasyon orkestrasyonu, analitik, dışa aktarım, veri taşıma ve güvenlik modeli.

## Katkıda bulunma

Katkılarınızı bekliyoruz. Geliştirme akışı, commit kuralları ve çeviri ekleme için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın (İngilizce; Türkçe issue ve PR'lar da memnuniyetle karşılanır). Güvenlik sorunlarını bildirmek için [SECURITY.md](SECURITY.md) dosyasını izleyin. Sürüm notları [CHANGELOG.md](CHANGELOG.md) dosyasındadır.

## Lisans

[MIT](LICENSE) © 2026 Bahadır Şahin ve katkıda bulunanlar.

MetaDash bağımsız bir projedir; Meta Platforms, Inc. ile bağlantılı değildir, onun tarafından desteklenmez veya onaylanmaz. Instagram ve Facebook, Meta Platforms, Inc.'in ticari markalarıdır.
