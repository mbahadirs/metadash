# Kendi sunucunuzda yayın worker'ı (isteğe bağlı)

[English](../worker.md)

MetaDash planlanan gönderileri bilgisayarınızdan yayınlar (tepsi modu). Bilgisayar planlanan saatte uykudaysa ya da
kapalıysa gönderi kaçırılır. **Worker**, kendiniz çalıştırdığınız küçük ve isteğe bağlı bir servistir — bir VPS, NAS
ya da Raspberry Pi üzerinde — ona verdiğiniz gönderileri tutar ve **Instagram, Facebook Sayfaları ve Threads**'e
zamanında yayınlar. Kullanmazsanız hiçbir şey değişmez.

Bilerek küçük tutuldu: sıfır npm bağımlılığı, tek bir JSON durum dosyası, tek HTTP portu, `/v1/health` dışında arayüz
yok; analitik yok, gelen kutusu yok, **telemetri yok**.

> Adlandırma: uygulamadaki `src/main/worker/` bu servisin istemcisidir. `src/main/publishing/worker.js` ise masaüstü
> uygulamasının ilgisiz yerel yayın kuyruğudur.

## Worker neleri alır (ve neleri asla almaz)

| Worker'a gönderilen | Asla gönderilmeyen |
|---|---|
| *Yayınlayan: Worker* olarak ayarladığınız gönderiler (açıklama, ilk yorum, format seçenekleri, medya dosyaları) | Analitik veriler, diğer gönderiler, notlar, müşteriler |
| Hesap başına bir yayın token'ı: Instagram için Meta kullanıcı token'ı, Facebook için **Sayfa token'ı**, Threads token'ı | Meta uygulama gizli anahtarı, AI anahtarları, Google/TikTok token'ları, Facebook için Meta *kullanıcı* token'ınız |
| | Veritabanınızdaki başka her şey |

Yayınlamanın ötesinde izinleri (reklam, istatistik, yorum, mesaj …) olan token'lar, **Daha geniş yetkili token'a izin
ver** işaretlenmedikçe reddedilir. En iyisi yalnızca yayın izinli ayrı bir token oluşturmaktır
(`instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`,
`business_management`; Threads: `threads_basic`, `threads_content_publish`) ve token formuna yapıştırmaktır.

## Hızlı başlangıç (Docker Compose)

1. MetaDash'te: **Ayarlar → Yayınlama → Kendi sunucunuzdaki worker → Gizli anahtar oluştur**. Çıkan metni worker
   makinesinde `.env` olarak kaydedin (`MD_WORKER_SECRET` ve `MD_WORKER_DATA_KEY` içerir; veri anahtarı yalnızca bir
   kez gösterilir).
2. `worker/docker-compose.yml` dosyasını (HTTPS için `worker/Caddyfile.example` ile birlikte) `.env`'in yanına
   kopyalayın, sonra:

   ```sh
   docker compose up -d                   # worker 127.0.0.1:8787'de (Tailscale / SSH tüneli / yerel ağ ile)
   docker compose --profile https up -d   # + otomatik HTTPS'li Caddy (.env'de MD_DOMAIN ve MD_PUBLIC_URL)
   ```
3. MetaDash'e dönün, worker adresini ve gizli anahtarı (ya da `mdw1:…` eşleştirme metnini) girip **Bağlan**'a basın.
   Masaüstü, kaydetmeden önce gizli anahtarı imzalı bir istekle doğrular.

   > **Yalnızca kendi çalıştırdığınız bir worker'ın eşleştirme metnini yapıştırın.** Eşleştirme metni bir kimlik
   > bilgisidir: MetaDash'in yayın token'larınızı nereye göndereceğini belirler. İlk token gönderilmeden önce MetaDash
   > çözülmüş worker adresini gösterir ve onayınızı ister; adres bu bilgisayarda değilse ve düz `http://` ise uyarır.
4. Worker'ın yayın yapacağı her hesap için bir token gönderin, ardından oluşturucuda gönderi ve hesap bazında
   **Yayınlayan → Worker** seçin (ya da yeni Meta gönderileri için worker'ı varsayılan yapın).

### docker run

```sh
docker run -d --name metadash-worker --restart unless-stopped \
  --env-file .env -v metadash-worker:/data -p 127.0.0.1:8787:8787 \
  ghcr.io/mbahadirs/metadash-worker:latest
```

Kendiniz derlemek için (imaj, uygulamayla `src/shared/publish` kodunu paylaştığından depo kökünü bağlam olarak ister):

```sh
docker build -f worker/Dockerfile -t metadash-worker .
```

Docker olmadan: Node.js 22+, ardından depo kökünden `MD_DATA_DIR=./data node worker/src/index.js`.

### NAS ve Raspberry Pi

İmaj çok mimarilidir (`linux/amd64`, `linux/arm64`). Synology/QNAP'ta kapsayıcı yöneticisini aynı ortam
değişkenleri ve `/data` için bir birimle kullanın. Raspberry Pi'de (64 bit işletim sistemi) `docker compose up -d`
olduğu gibi çalışır. Kaynak ihtiyacı çok düşüktür: tek Node süreci, birkaç MB bellek ve sıradaki gönderilerin medya
dosyaları (yayından 7 gün sonra silinir).

## Ağ ve TLS

Worker her isteği doğrular (HMAC, aşağıda), ancak HMAC içeriği gizlemez. **Worker özel bir ağda değilse mutlaka TLS
kullanın**:

- **Önerilen:** portu dışarı açmayın, **Tailscale / WireGuard** üzerinden erişin (ör.
  `http://worker.tailnet-adi.ts.net:8787`). İnternete hiçbir şey açılmaz.
- **Herkese açık HTTPS:** Compose `https` profili otomatik sertifikalı **Caddy** çalıştırır. `MD_DOMAIN` ve
  `MD_PUBLIC_URL=https://<alan-adı>` ayarlayın. Başka bir ters vekil de olur, yeter ki **yolları ve sorgu
  dizelerini değiştirmesin** (imza bunları kapsar) ve 110 MB istek gövdelerine izin versin.
- **Bir vekilin arkasında `MD_TRUST_PROXY=1` ayarlayın.** Aksi hâlde her istek vekilin adresinden gelmiş gibi görünür;
  tüm istemciler tek bir hız sınırını paylaşır ve herhangi birinden gelen 20 hatalı istek *herkesi* 15 dakika
  kilitler. Compose dosyası bunu varsayılan olarak `1` yapar. Başlık yalnızca doğrudan bağlanan taraf bir loopback
  ya da özel ağ adresiyse (vekiliniz) dikkate alınır ve içindeki en sağdaki herkese açık adres kullanılır; böylece
  istemciler kendi adreslerini seçemez.

### Medya adresleri

Instagram görselleri ve tüm Threads medyası, Meta'nın indirebileceği herkese açık bir HTTPS adresinde olmalıdır
(Meta'nın güncel medya indirme koşulları DOĞRULANMALI). İki seçenek:

1. `MD_PUBLIC_URL` ayarlıysa worker, yüklenen dosyaları imzalı ve süreli bağlantılarla sunar:
   `GET /m/<sha256>?exp=…&sig=…` (24 saat). Yalnızca bu bağlantılar çalışır; gerisi 404'tür.
2. Herkese açık adres yoksa masaüstü, gönderiyi aktarırken **Ayarlar → Yayınlama**'daki medya sunucunuzu (S3 uyumlu
   depolama vb.) kullanır; sunucu yoksa adres gerektiren gönderileri göndermez. Ön imzalı adresler yayın anında hâlâ
   geçerli olmalıdır.

Facebook yüklemeleri ve Instagram videoları worker tarafından doğrudan yüklenir (herkese açık adres gerekmez).

## Yapılandırma

| Değişken | Varsayılan | |
|---|---|---|
| `MD_WORKER_SECRET` | — (zorunlu, ≥ 32 karakter) | eşleştirme sihirbazındaki paylaşılan gizli anahtar |
| `MD_WORKER_DATA_KEY` | — (zorunlu, ≥ 32 karakter) | token'ların saklanırken şifrelenmesi için anahtar; `/data`'ya asla yazılmaz |
| `MD_PUBLIC_URL` | boş | imzalı medya bağlantıları için herkese açık `https://` adresi |
| `MD_DATA_DIR` | `/data` | durum dosyası + medya |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | |
| `MD_STRICT_SCOPES` | `1` | alınan Instagram token izinlerini Meta'da (`/me/permissions`) ve token geçerliliğini yeniden kontrol eder |
| `MD_TRUST_PROXY` | `0` (`docker-compose.yml` içinde `1`) | hız sınırı ve kilitleme için `X-Forwarded-For` kullan; ters vekil arkasında gereklidir. Yalnızca loopback/özel ağ adreslerinden gelen bağlantılarda dikkate alınır |
| `MD_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `TZ` | kapsayıcı varsayılanı | `/v1/info`'da gösterilir |

Her değişken `<AD>_FILE` biçimini de kabul eder (Docker secrets), ör. `MD_WORKER_DATA_KEY_FILE=/run/secrets/md_data_key`.

## Nasıl çalışır

- **İçerik** masaüstünündür; **yürütme durumu** worker'ındır. Her planlayıcı hedefinin bir `executor` değeri
  (`local` | `worker`) ve her düzenleme ya da yeniden planlamada artan bir `revision` değeri vardır. Yerel tepsi
  yayıncısı worker hedeflerini atlar; hiçbir şey iki kez yayınlanmaz.
- Masaüstü her 2 dakikada bir (ve planlayıcı değişikliklerinden birkaç saniye sonra) eşitler: revizyonu worker'ın
  kabul ettiğinden yeni olan hedefleri gönderir ve durum değişikliklerini çeker (`GET /v1/changes?since=<imleç>`).
- Worker 20 saniyede bir çalışır. Kapsayıcılar planlanan saatten 5 dk (video: 20 dk) önce hazırlanır ve tam
  zamanında yayınlanır. Her adım bir sonraki Meta çağrısından önce kaydedilir; çökme ya da yeniden başlatma sonrası
  kaldığı yerden devam eder. Yayın çağrısı sırasında kesilen bir öğe **kurtarılır, asla yeniden yayınlanmaz**.
- Geçici hatalarda 1, 2, 5, 10, 30 dk beklenir (6 deneme); süresi dolan kapsayıcılar bir kez yeniden kurulur; geçersiz
  token, eksik izin ve reddedilen medya hemen başarısız olur. Yayından önce IG günlük yayın sınırı kontrol edilir.
- Worker kapalıyken bir öğe 6 saatten fazla gecikirse geç yayınlanmak yerine **kaçırıldı** olur. Planlayıcıda
  *Şimdi yayınla* ya da *Yeniden planla* kullanın; yeni revizyon worker'a geri gider.
- **Geri alma**: hedefi *Bu bilgisayar*'a geri almak onu worker'dan siler. Worker yayına başladıysa (kapsayıcı
  oluşturulduysa) 409 döner ve gönderi worker'da kalır.
- Threads token'ları, 20 gün içinde bitecekse worker'da yenilenir (yeni bitiş tarihi Ayarlar'da görünür).
- Tamamlanan öğeler 30 gün, medya yayından 7 gün sonra silinir. **Bağlantıyı kes**, worker'daki tüm öğeleri,
  token'ları ve medyayı siler ve tüm hedefleri bu bilgisayara geri verir.

### Protokol v1

`GET /v1/health` dışındaki tüm istekler `X-MD-Protocol: 1`, `X-MD-Ts` (ms), `X-MD-Nonce` (16 rastgele bayt) ve
`X-MD-Sig = HMAC-SHA256(K_auth, YÖNTEM \n YOL?SORGU \n TS \n NONCE \n SHA256(gövde))` taşır;
`K_auth = HKDF(secret, 'mdw-auth-v1')`. ±300 saniyeden fazla sapan, tekrarlanan nonce'lu ve hatalı imzalı istekler
reddedilir. Uç noktaların listesi için İngilizce belgeye bakın ([../worker.md](../worker.md#protocol-v1)).

Hız sınırı: istemci başına dakikada 120 istek; 10 dakikada 20 kimlik doğrulama hatası istemciyi 15 dakika kilitler.

## Yedekleme, anahtar değiştirme, güncelleme

- `/data` birimini **yedekleyin** (`state.json` ve medya). İçindeki token'lar `MD_WORKER_DATA_KEY` ile şifrelidir;
  bu anahtarı yedeğin yanında değil, parola yöneticinizde saklayın. Anahtar yoksa token'ları Ayarlar'dan yeniden
  gönderin (kuyruğu masaüstü otomatik olarak yeniden gönderir).
- **Gizli anahtarı değiştirme**: `metadash worker rotate` (CLI) yeni anahtarı eskisiyle mühürleyip gönderir; worker
  onu şifreli saklar, masaüstü worker onayladıktan sonra geçer. Yazdırılan `MD_WORKER_SECRET` değerini uygun bir
  zamanda worker `.env` dosyasına koyun. `MD_WORKER_DATA_KEY` değiştirmek = yeni anahtar + token'ları yeniden gönderme.
- **Güncelleme**: `docker compose pull && docker compose up -d`. Durum dosyası sürümlüdür; worker bilinmeyen bir
  sürümle karşılaşırsa dosyayı bozmak yerine başlamayı reddeder.

## Tehdit modeli

| Tehdit | Önlem |
|---|---|
| Ağdaki biri API'yi çağırır | her uç noktada HMAC, nonce + zaman penceresi, hız sınırı ve kilitleme |
| Başkasının eşleştirme metni token'larınızı başka yere yönlendirir | masaüstü ilk token gönderiminden önce çözülmüş adresi gösterip onay ister; yerel olmayan `http://` için uyarır; yalnızca kendi çalıştırdığınız worker ile eşleştirin |
| TLS sonlandıran vekil ya da ağ gözlemcisi | token'lar gizli anahtardan türetilen bir anahtarla mühürlü gider; içerik için TLS/Tailscale kullanın |
| Çalınan `/data` birimi ya da yedek | token'lar `MD_WORKER_DATA_KEY` ile şifreli (`/data`'da değil) |
| Worker makinesi tamamen ele geçirilir | saldırgan yalnızca yayın token'larını alır (Facebook için kullanıcı token'ı yok, uygulama gizli anahtarı yok, analitik yok); token'ları Meta'da iptal edip yeniden eşleştirin |
| Kesinti sonrası eski gönderilerin çıkması | 6 saatten fazla geciken öğeler *kaçırıldı* olur |
| Çift yayın | hedef başına tek yürütücü; geri alma yalnızca yayından önce; çökme kurtarma asla yeniden yayınlamaz |
| Medya adreslerini tahmin etme | içerik adresli adlar + HMAC imzalı süreli bağlantılar, yalnızca `MD_PUBLIC_URL` ile |
| Günlük sızıntıları | günlükleyici token, gizli anahtar, imza, zarf ve gövdeleri gizler |
| Tedarik zinciri | sıfır npm bağımlılığı; imaj bu depodan CI'da derlenir, root olmayan kullanıcı (uid 10001), Compose'da salt okunur kök dosya sistemi |

## Sorun giderme

- *Worker isteği reddetti (gizli anahtar)*: yanlış anahtar ya da saatler 5 dakikadan fazla farklı (NTP'yi açın).
- *Birkaç hatalı istekten sonra herkes kilitleniyor*: worker bir vekilin arkasında `MD_TRUST_PROXY=1` olmadan
  çalışıyor (bkz. [Ağ ve TLS](#ağ-ve-tls)).
- *Erişilemiyor*: `docker compose ps`, adresi ve Tailscale'in açık olduğunu kontrol edin. CLI'dan
  `metadash worker test` gidiş-dönüşü yazdırır.
- *Herkese açık medya adresi gerekiyor*: `MD_PUBLIC_URL` (HTTPS ile) ayarlayın ya da Ayarlar → Yayınlama'da bir
  medya sunucusu kurun.
- CLI: `metadash worker status | sync | test | rotate`.
