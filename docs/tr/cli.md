# Komut satırı aracı (penceresiz mod)

[English](../cli.md)

MetaDash penceresini açmadan da çalışabilir. `--cli` ile başlatılan uygulama dosyası veriyi senkronize eder, rapor ve dışa aktarım yazar, durum bilgisini verir. Betiklerde ve zamanlanmış işlerde kullanabilirsiniz; örneğin her ayın 1'inde geçen ayın PDF raporlarını üretmek için.

- Komut satırı uygulamayla aynı veritabanını, bağlantıları, marka ayarlarını ve rapor şablonlarını kullanır. Ayrıca bir şey kurmanız gerekmez.
- Uygulama açıkken de çalışabilir. Aynı anda yalnızca bir senkronizasyon çalışır: uygulama senkronize ediyorsa `metadash sync` 5 koduyla çıkar; komut satırı senkronize ederken uygulama "komut satırından çalışıyor" gösterir.
- Belirteçler ve gizli anahtarlar `--json` ile bile hiçbir zaman yazdırılmaz.

## Çalıştırma

Komut satırı aracı uygulama dosyasının kendisidir. `--cli` ve ardından bir komutla başlatın:

| İşletim sistemi | Komut (varsayılan kurulum yeri) |
|---|---|
| macOS | `/Applications/MetaDash.app/Contents/MacOS/MetaDash --cli <komut>` |
| Windows | `"%LOCALAPPDATA%\Programs\MetaDash\MetaDash.exe" --cli <komut>` |
| Linux (deb) | `/opt/MetaDash/metadash --cli <komut>` |
| Linux (AppImage) | `./MetaDash-<sürüm>-linux-x86_64.AppImage --cli <komut>` |
| Geliştirme | `npm run cli -- <komut>` (`electron . --cli <komut>` ile aynı) |

`--cli` olmadan dosya normal uygulama penceresini açar.

### `metadash` komutu

**Ayarlar → Komut satırı aracı → metadash komutunu kur** küçük bir betik yazar; böylece `metadash <komut>` yazabilirsiniz:

- **macOS:** `/usr/local/bin/metadash`. Bu klasöre yazılamıyorsa betik `~/.local/bin/metadash` içine konur.
- **Linux:** `~/.local/bin/metadash`.
- **Windows:** `%LOCALAPPDATA%\MetaDash\bin\metadash.cmd`. Bu klasörü kullanıcı PATH değişkeninize ekleyin (Ayarlar → Sistem → Hakkında → Gelişmiş sistem ayarları → Ortam Değişkenleri), sonra yeni bir terminal açın.

Betiği başka bir klasöre de (mutlak yol) kurabilirsiniz. Bölüm, klasörün PATH içinde olup olmadığını gösterir. **Kaldır** yalnızca MetaDash'in oluşturduğu dosyaları siler. Betik yalnızca `"<uygulama dosyası>" --cli "$@"` çalıştırır; uygulama aynı yerde kaldıkça güncellemelerden sonra da çalışır.

Bu sayfanın geri kalanında `metadash` yazılıdır. Betiği kurmadıysanız yukarıdaki tablodaki tam komutu kullanın.

## Komutlar

Her komut `--help` kabul eder, örneğin `metadash report --help`. `metadash help` tüm komutları listeler. Yardım metinleri İngilizcedir; hata mesajları uygulama dilinde (ya da `--lang` ile seçilen dilde) yazılır.

### Genel seçenekler

| Seçenek | Anlamı |
|---|---|
| `--json` | Makinece okunabilir çıktı: stdout'a tek bir JSON belgesi. İlerleme ve mesajlar stderr'e gider. |
| `-q`, `--quiet` | stderr'e ilerleme satırı yazılmaz. Hatalar yine yazılır. |
| `--lang <kod>` | Mesajların ve raporların dili (`en`, `tr`, `de`, `es`). Varsayılan uygulama dilidir. |
| `--user-data <klasör>` | Başka bir veri klasörü kullanır, örneğin veritabanının bir kopyası. |
| `--log-file <dosya>` | Sonuçlar dahil tüm çıktıyı zaman damgasıyla bir dosyaya ekler. Windows'ta ve zamanlanmış işlerde önerilir. |
| `-v`, `--version` | Uygulama sürümü. |

### `metadash accounts`

İzlenen hesapları **anahtar**, platform, @kullanıcıadı, ad, müşteri, takipçi ve son senkronizasyon zamanıyla listeler.

```sh
metadash accounts
metadash accounts --platform instagram,fb --client "Acme" --json
metadash accounts --tag Perakende --search kahve --all   # --all izlenmeyen hesapları da gösterir
```

Diğer komutlar hesapları şu biçimlerde kabul eder:

- `@kullanıcıadı`
- `platform:@kullanıcıadı`. Kısaltmalar: `ig`, `fb`, `th`, `yt`, `tt`.
- Hesap anahtarı: `1784…` (Instagram), `fb-…`, `th-…`, `yt-…`, `tt-…`.

Anahtar olmayan düz bir kelime kullanıcı adı olarak denenir. Bir kullanıcı adı birden fazla platformda varsa komut 2 koduyla çıkar ve adayları listeler.

### `metadash sync`

Uygulamadaki **Yenile** gibi güncel veriyi çeker ve bitene kadar bekler. İlerleme satırları (`[bitti/toplam] aşama hesap`) stderr'e gider.

```sh
metadash sync                                   # her şey
metadash sync --scope organic --platform instagram,threads
metadash sync --scope ads
metadash sync --account @marka --account fb:@marka
metadash sync --client "Acme" --json
```

| Seçenek | Değerler |
|---|---|
| `--scope` | `full` (varsayılan), `organic`, `ads`, `stories`, `competitors`, `inbox` |
| `--platform` | Yalnızca bu platformlar (virgülle ayrılmış ya da tekrarlanmış) |
| `--account`, `--client`, `--tag` | Yalnızca bu hesaplar (tekrarlanabilir) |

Çıkış kodları:

| Kod | Anlamı |
|---|---|
| 0 | Senkronizasyon hatasız bitti. |
| 3 | Senkronizasyon bitti ama bazı işler başarısız oldu. Hatalar yazdırılır. |
| 4 | Bir bağlantının uygulamada yeniden bağlanması gerekiyor (belirtecin süresi dolmuş, iptal edilmiş ya da eksik) ya da hiçbir şey bağlı değil. |
| 5 | Başka bir senkronizasyon çalışıyor (uygulamada ya da başka bir komut satırı işleminde). |
| 6 | Salt okunur paylaşılan ekip çalışma alanı. |

Demo verisiyle API çağrısı yapılmaz; demo veri seti bir gün ilerler.

### `metadash report`

**Raporlar → Dışa aktar** ile aynı raporları yazar: aynı şablonlar, bölümler, marka ve PDF çıktısı. PDF, uygulamadaki gibi gizli bir pencereden basılır.

```sh
# Bir hesabın geçen ay raporu (PDF; biçim uzantıdan)
metadash report --template monthly --account @marka --out ~/Raporlar/marka.pdf

# Bir müşterinin her hesabı için ayrı dosya; belirteçler dosya başına doldurulur
metadash report -t monthly --client "Acme" --period last_month \
  --out "~/Raporlar/{client}/{account}-{platform}-{from}.pdf"

# "Perakende" etiketli hesapların haftalık portföyü, yalnızca Instagram, Excel olarak
metadash report -t portfolio --tag Perakende --platform instagram --period last_week --out perakende-{date}.xlsx

# Türkçe, özel aralık, yalnızca bazı bölümler, yapay zekâ yorum taslağıyla
metadash report -t custom --account ig:@marka --from 2026-01-01 --to 2026-03-31 \
  --lang tr --sections kpis,reach,posts --commentary ai --out q1.html
```

| Seçenek | Değerler |
|---|---|
| `-t`, `--template` | `monthly`, `weekly_client`, `custom`, `campaign` (bunlar hesap ister), `portfolio`, `weekly` (bunlar tüm hesapları kapsar; `--tag` / `--platform` ile süzülür) |
| `--account`, `--client`, `--tag` | Hesap seçimi (tekrarlanabilir). `campaign` dosya başına tek hesap kapsar. |
| `--platform` | Portföy / haftalık süzgeci ya da seçilen hesapları daraltır |
| `--period` | `today`, `yesterday`, `last_7d`, `last_14d`, `last_28d`, `last_30d`, `last_90d`, `this_week`, `last_week`, `this_month`, `last_month` |
| `--from`, `--to` | Açık aralık, `YYYY-AA-GG`. `--period`'a göre önceliklidir. |
| `--format` | `pdf`, `html`, `xlsx`. Varsayılan `--out` uzantısından gelir, yoksa `pdf`. |
| `--sections` / `--exclude-sections` | Yalnızca bu bölümleri tutar ya da bazılarını çıkarır (adlar `--help` içinde, örn. `kpis`, `reach`, `posts`, `ads`) |
| `--commentary` | `none` (varsayılan) ya da `ai`: uygulamada kurulu yapay zekâ sağlayıcısından bir taslak. Başarısız olursa rapor yorumsuz yazılır. |
| `--commentary-file` | Yorum metni bir dosyadan okunur |
| `--cover-title` | Kapak başlığı |
| `-o`, `--out` | Çıktı dosyası. Eksik klasörler oluşturulur. Belirteçler: `{account}` `{platform}` `{client}` `{template}` `{from}` `{to}` `{date}` (bugün) `{format}` |

`--period` ya da `--from/--to` verilmezse `monthly` geçen ayı, `weekly_client` ve `weekly` son 7 günü, `portfolio` ve `campaign` son 30 günü kapsar. `custom` her zaman bir dönem ister. `last_Nd`, uygulamadaki gibi bugün dahil son N gün demektir. `last_week` (pazartesi–pazar) ve `last_month` tam dönemlerdir; zamanlanmış raporlar için doğru seçim bunlardır.

`--out` içinde `{account}` varsa seçilen her hesap için ayrı dosya yazılır. Yoksa tüm hesaplar tek bir çok hesaplı rapora girer. Bir müşterinin iki platformda aynı kullanıcı adı varsa dosya adlarının ayrışması için `{platform}` ekleyin. İki dosya çakışacaksa komut hiçbir şey yazmadan 2 koduyla çıkar.

Çıkış kodları: 0 tüm dosyalar yazıldı, 2 hatalı argüman, 3 bazı dosyalar başarısız, 1 hepsi başarısız.

### `metadash export` ve `metadash backup`

```sh
metadash export list                                        # hazır sorgular
metadash export csv  --query media --out media.csv
metadash export csv  --query accounts --out - | head        # CSV stdout'a
metadash export csv  --sql "SELECT username, followers FROM accounts a JOIN account_snapshots s USING (ig_id)" --out f.csv
metadash export xlsx --query accounts,media,snapshots --out metadash-{date}.xlsx
metadash backup --out ~/Yedekler/metadash.metadash
MD_PASS='…' metadash backup --out yedek.metadash --passphrase-env MD_PASS
```

- Hazır sorgular `accounts`, `media`, `account_insights`, `snapshots`, `stories`, `ads`, `competitors` ve `sync_errors`'tır; Ayarlar'daki dışa aktarım hazır ayarlarıyla aynıdır.
- `--sql` yalnızca salt okunur sorguları (`SELECT` / `WITH`) kabul eder.
- CSV dosyaları BOM'lu UTF-8'dir; Excel onları doğru açar.
- `backup`, **Ayarlar → Aktarım** ile aynı dosyadır. Belirteçler ve uygulama gizli anahtarları, `--passphrase-env` bir parola içeren ortam değişkenini göstermedikçe yedeğe konmaz; gösterirse o parolayla şifrelenir. Parolanın kendisini asla komut satırına yazmayın.

### `metadash status`

Şunları gösterir:

- Son senkronizasyon ve son başarılı senkronizasyon.
- Şu anda bir senkronizasyonun çalışıp çalışmadığı ve kimin başlattığı (uygulama ya da komut satırı).
- Her bağlantının belirteç durumu: `ok`, `expiring` (7 günden az), `expired`, `missing`, `demo`. YouTube ve TikTok bağlantıları belirteçlerini kendileri yeniler ve `ok` görünür.
- Platform başına izlenen hesaplar.
- Bugün kullanılan API kotası (YouTube).
- Yayın sunucusu ve ekip çalışma alanı.

`metadash status --check` bir bağlantının süresi dolmuşsa, eksikse ya da okunamıyorsa, veya hiçbir şey bağlı değilse 4 koduyla çıkar. İzleme betiklerinde kullanın.

### Diğer komutlar

`metadash inbox …`, `metadash worker …` ve `metadash team …` birleşik gelen kutusu, yayın sunucusu ve ekip özelliklerine aittir. Bkz. [inbox.md](inbox.md), [worker.md](worker.md) ve [team.md](team.md).

## Çıkış kodları

| Kod | Ad | Anlamı |
|---|---|---|
| 0 | OK | Başarılı |
| 1 | ERROR | Beklenmeyen hata (mesaj yazdırılır) |
| 2 | USAGE | Hatalı argüman, bilinmeyen komut ya da hesap, belirsiz hesap (adaylar yazdırılır) |
| 3 | PARTIAL | Bazı hatalarla bitti |
| 4 | AUTH | Yeniden bağlanma gerekli ya da hiçbir şey bağlı değil |
| 5 | LOCKED | Zaten bir senkronizasyon çalışıyor (uygulama ya da başka bir komut satırı) |
| 6 | READ_ONLY | Salt okunur paylaşılan ekip çalışma alanı; veriyi değiştiren komutlar kapalı |
| 7 | NOT_IMPLEMENTED | Bu sürümde yok |

## Zamanlama

Aşağıdaki örneklerin hepsi her gün 06:00'da tam senkronizasyon yapar ve ayın 1'inde geçen ayın müşteri raporlarını yazar. Her iş senkronizasyonun bitmesini bekler. O anda uygulama senkronize ediyorsa iş 5 koduyla çıkar; sonra yeniden çalıştırın ya da bu kodu yok sayın.

### cron (macOS / Linux)

`crontab -e`:

```cron
# dk sa gün ay hg
0 6 * * *  /usr/local/bin/metadash sync --quiet --log-file "$HOME/metadash-cli.log"
30 6 1 * * /usr/local/bin/metadash report -t monthly --client "Acme" --period last_month --out "$HOME/Raporlar/{client}/{account}-{platform}-{from}.pdf" --quiet --log-file "$HOME/metadash-cli.log"
```

cron'un PATH'i çok kısadır; betiğin ya da uygulama dosyasının tam yolunu kullanın. macOS'ta cron'dan Belgeler ya da Masaüstü klasörüne yazmak `/usr/sbin/cron` için **Tam Disk Erişimi** gerektirebilir; launchd (aşağıda) genellikle daha kolaydır.

### launchd (macOS)

`~/Library/LaunchAgents/com.metadash.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.metadash.sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/MetaDash.app/Contents/MacOS/MetaDash</string>
    <string>--cli</string>
    <string>sync</string>
    <string>--quiet</string>
    <string>--log-file</string>
    <string>/Users/siz/Library/Logs/metadash-cli.log</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>
</dict>
</plist>
```

`launchctl load ~/Library/LaunchAgents/com.metadash.sync.plist` ile yükleyin. launchd, kaçırılan işi Mac uyandığında çalıştırır. Aylık rapor için `StartCalendarInterval` içinde `<key>Day</key><integer>1</integer>` olan ve `report` argümanlarını içeren ikinci bir ajan ekleyin.

### Görev Zamanlayıcı (Windows)

Windows uygulaması bir GUI programıdır; konsol çıktısı `cmd.exe`'de görünmeyebilir. Zamanlanmış görevlerde her zaman dosyalar için `--out`, mesajlar için `--log-file` kullanın.

```bat
schtasks /Create /TN "MetaDash sync" /SC DAILY /ST 06:00 ^
  /TR "\"%LOCALAPPDATA%\Programs\MetaDash\MetaDash.exe\" --cli sync --quiet --log-file \"%USERPROFILE%\metadash-cli.log\""

schtasks /Create /TN "MetaDash aylik raporlar" /SC MONTHLY /D 1 /ST 06:30 ^
  /TR "\"%LOCALAPPDATA%\Programs\MetaDash\MetaDash.exe\" --cli report -t monthly --client Acme --period last_month --out \"%USERPROFILE%\Raporlar\{account}-{platform}-{from}.pdf\" --log-file \"%USERPROFILE%\metadash-cli.log\""
```

Bir toplu iş dosyasında komuttan sonra yukarıdaki çıkış kodlarıyla `%ERRORLEVEL%` değerini kontrol edin.

## Ekransız Linux sunucular

PDF raporları Chromium tarafından basılır; pencere gösterilmese de Electron bir ekrana ihtiyaç duyar. Ekranı olmayan bir sunucuda:

- Sanal ekranla çalıştırın: `xvfb-run -a metadash report … --format pdf` (`xvfb` paketi).
- Ya da Chromium'un ekransız modunu deneyin: `metadash --ozone-platform=headless --cli report …` (Electron 33; her dağıtımda desteklenmez).
- HTML ve Excel raporları, `sync`, `export`, `accounts` ve `status` için de Electron'un başlaması gerekir. Bir komut ekransız başlamazsa onu da `xvfb-run -a` ile çalıştırın.

Veri klasörü `~/.config/MetaDash`'tir. Bir kopyayı göstermek için `--user-data <klasör>` kullanın.

## Geliştirme

- `npm run cli -- status` komut satırını kaynak ağacından çalıştırır.
- `node scripts/cli-smoke.mjs` demo veriyi geçici bir klasöre yükler ve gerçek bir PDF dahil her komutu uçtan uca çalıştırır. Linux'ta ekran yoksa `xvfb-run` kullanır. Dosyaları tutmak için `--keep` ekleyin.
- Testler: `tests/cli.args.test.js` (ayrıştırma, çözümleme, çıkış kodları), `tests/cli.commands.test.js` (demo veritabanında komutlar), `tests/cli.sync.integration.test.js` (kilit çakışması, sahte Graph API'ye karşı geçersiz belirteç), `tests/cli.shim.test.js`.
- Kod: `src/main/cli/` (`index.js` komut tablosu ve genel seçenekler, `output.js`, `resolve.js`, `args.js`, `shim.js`, `commands/*.js`) ve `src/main/export/params.js` (dönem hazır ayarları ve rapor parametreleri; Raporlar sayfasının karşılığı).
