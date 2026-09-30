# Yayımlama kurulumu (Planlayıcı)

[English](../publishing-setup.md)

MetaDash, **Planlayıcı**'da hazırladığınız gönderileri Instagram, Facebook Sayfaları ve Threads'te yayımlayabilir. Bu kılavuz her platformun gerektirdiği izinleri, Instagram ve Threads için gereken medya barındırmayı, MetaDash'in kontrol ettiği sınırları ve bilgisayar kapalıyken neler olduğunu anlatır.

Yayımlama isteğe bağlıdır. Analiz bunların hiçbiri olmadan çalışır.

- [1. İzinler](#1-izinler)
- [2. Medya barındırma (Instagram ve Threads)](#2-medya-barındırma-instagram-ve-threads)
- [3. Bilgisayar kapalıyken ne çalışır](#3-bilgisayar-kapalıyken-ne-çalışır)
- [4. Yayımlama nasıl işler](#4-yayımlama-nasıl-işler)
- [5. Sınırlar](#5-sınırlar)
- [6. Sorun giderme](#6-sorun-giderme)

---

## 1. İzinler

| Platform | İzin | Ne için |
|---|---|---|
| Instagram | `instagram_content_publish` | gönderi, karusel, reels, hikâye |
| Instagram | `instagram_manage_comments` | ilk yorum |
| Facebook Sayfaları | `pages_manage_posts` | gönderi, fotoğraf, albüm, video, reels, Facebook'ta zamanlama |
| Facebook Sayfaları | `pages_manage_engagement` | ilk yorum |
| Threads | `threads_content_publish` | gönderi |
| Threads | `threads_manage_replies` | ilk yorum (yanıt olarak gönderilir) |

**Instagram ve Facebook**, analizle aynı Meta token'ını kullanır:

1. İzinleri uygulamanızın kullanım senaryosuna ekleyin ([meta-app-setup.md](meta-app-setup.md), Bölüm 3.2).
2. Graph API Explorer'da bu izinler işaretliyken yeni bir token oluşturun (Bölüm 6) ve MetaDash'te dönüştürün (Ayarlar → Bağlantı → **Token yenile**). Token yalnızca oluşturulurken işaretlenen izinleri taşır; izinleri ekledikten sonra token'ı yenilemeniz gerekir.
3. Her Facebook Sayfasında `CREATE_CONTENT` görevi de olmalıdır. Explorer'da `me/accounts?fields=name,tasks` ile kontrol edin.

**Threads:** `threads_content_publish` ve `threads_manage_replies` izinlerini uygulamanızın Threads kullanım senaryosuna ekleyin ([threads-setup.md](threads-setup.md)) ve yeni yetkilendirme bu izinleri içerecek şekilde Threads'i yeniden bağlayın. MetaDash yayımlama izinlerini yalnızca yayımlama açıkken bağlandığınızda ister; çünkü uygulamada bu izinler yoksa Threads giriş sayfası hata gösterir.

Ayarlar → Yayımlama, her platform için yayımlama yapılıp yapılamayacağını ve eksik izinleri gösterir. Düzenleyici, eksik bir yayımlama izni için engelleyici bir hata, yalnızca ilk yorum izni eksikse bir uyarı gösterir.

## 2. Medya barındırma (Instagram ve Threads)

Instagram ve Threads görselleri dosya olarak kabul etmez: Meta onları **herkese açık bir adresten** indirir. Threads videolar için de herkese açık adres ister. (Instagram videoları ve Facebook'taki her şey doğrudan yüklenir; bunlar için barındırma gerekmez.)

Bu yüzden MetaDash dosyayı sizin kontrolünüzdeki depolamaya kopyalar, bağlantıyı Meta'ya verir ve yayımlandıktan sonra kopyayı siler. Barındırmayı Ayarlar → Yayımlama'dan seçin:

| Barındırma | Neler için | Not |
|---|---|---|
| **S3 uyumlu bucket** (önerilen) | görsel ve video | Cloudflare R2, AWS S3, Backblaze B2, MinIO, Wasabi |
| Facebook Sayfası (deneysel) | yalnızca görsel | resmî değil; bkz. 2.4 |
| Zaten barındırılıyor | görsel ve video | medya klasörünü kendiniz yansıtırsınız; bkz. 2.5 |
| Yok | – | Instagram görsel gönderileri ve Threads medya gönderileri engellenir |

Anahtarlar bu bilgisayarda şifreli saklanır (Meta token'ınız gibi). Medya yalnızca bilgisayarınızdan bucket'ınıza, bucket'ınızdan da Meta'ya gider.

### 2.1 Cloudflare R2 (adım adım)

R2'nin ücretsiz katmanı vardır ve çıkış trafiği ücreti yoktur; bu iş için uygundur.

1. Cloudflare paneli → **R2** → **Create bucket**, örn. `metadash-media`. Gizli (private) bırakın.
2. R2 → **Manage R2 API Tokens** → **Create API token** → **Object Read & Write** izni, yalnızca o bucket. **Access Key ID** ve **Secret Access Key** değerlerini kopyalayın.
3. **Hesap kimliğinizi** not edin: S3 endpoint'i `https://<hesap-kimliği>.r2.cloudflarestorage.com` olur.
4. MetaDash → Ayarlar → Yayımlama → Medya barındırma **S3 uyumlu**:
   - Endpoint: `https://<hesap-kimliği>.r2.cloudflarestorage.com`
   - Bölge (region): `auto`
   - Bucket: `metadash-media`
   - Path-style adresler: açık
   - Access key ID / Secret access key: 2. adımdan
5. **Test** düğmesine basın. MetaDash 1×1 bir JPEG yükler, Meta'nın alacağı bağlantıdan anonim olarak indirir ve siler.
6. Güvenlik ağı olarak bir yaşam döngüsü kuralı ekleyin (aşağıda).

Varsayılan olarak Meta, `URL ömrü` sonunda (varsayılan 24 saat, en fazla 7 gün) geçersiz olan **imzalı (presigned) bir bağlantı** alır. Herkese açık bir bucket veya özel alan adı kullanmak isterseniz (R2 → bucket → Settings → Public access / Custom domain), bunu **Herkese açık temel adres** olarak girin (örn. `https://media.example.com`); MetaDash bu durumda `<temel adres>/<anahtar>` gönderir. Meta imzalı bağlantıları reddederse bunu kullanın.

### 2.2 AWS S3

1. Bir bucket oluşturun (imzalı bağlantı kullanırken Block Public Access açık kalabilir).
2. `arn:aws:s3:::<bucket>/metadash/*` üzerinde `s3:PutObject`, `s3:GetObject` ve `s3:DeleteObject` izni veren bir IAM kullanıcısı ve ona ait bir erişim anahtarı oluşturun.
3. MetaDash'te **Endpoint**'i boş bırakın, **Bölge**'yi bucket'ın bölgesine ayarlayın (örn. `eu-central-1`) ve path-style adresleri kapatın.

### 2.3 MinIO, Backblaze B2, Wasabi

Sağlayıcının S3 endpoint'ini ve bölgesini kullanın; örn. B2 için `https://s3.eu-central-003.backblazeb2.com`, MinIO için `https://minio.example.com`. MinIO için ve adında nokta olan bucket'lar için **path-style adresleri** açın. Endpoint `https` olmalıdır (düz `http` yalnızca `localhost` için kabul edilir). Meta adrese internetten erişebilmelidir; dizüstü bilgisayarınızdaki bir MinIO ancak herkese açık bir HTTPS adresi arkasında çalışır.

### Yaşam döngüsü kuralı (önerilen)

MetaDash her kopyayı gönderi yayımlandıktan sonra siler (**Yayımladıktan sonra sil**, varsayılan olarak açık). Bir gönderi başarısız olursa ya da uygulama yanlış anda kapanırsa bir kopya kalabilir. `metadash/` önekindeki nesneleri 2 gün sonra silen bir kural ekleyin:

- R2: bucket → Settings → **Object lifecycle rules** → önek `metadash/`, 2 gün sonra sil.
- AWS: bucket → Management → **Create lifecycle rule** → önek `metadash/`, güncel sürümleri 2 gün sonra sona erdir.

### 2.4 Facebook Sayfası barındırması (deneysel)

MetaDash görseli yönettiğiniz bir Facebook Sayfasına **yayımlanmamış fotoğraf** olarak yükler, fotoğrafın CDN bağlantısını alır ve Instagram/Threads'e onu verir. Fotoğraf yayımlandıktan sonra silinir. Instagram hesapları bağlı Sayfalarını kullanır; Threads için Ayarlar'da bir Sayfa kimliği girin.

Bu resmî bir Meta özelliği değildir: CDN bağlantıları imzalıdır ve süresi dolabilir, her an çalışmayı bırakabilir. Videolarla çalışmaz. Düzenli yayımlıyorsanız bir bucket kullanın.

### 2.5 Zaten barındırılıyor

Bir klasörü zaten bir web sunucusuyla eşitliyorsanız MetaDash'i onun herkese açık temel adresine yönlendirin. Dosyalar `<temel adres>/<sha256>.<uzantı>` olarak erişilebilir olmalıdır; bu, MetaDash'in `planner-media` klasöründe (uygulama veri klasöründe) kullandığı addır. MetaDash yayımlamadan önce her dosyayı anonim bir HEAD isteğiyle kontrol eder. Dönüştürme gerektiren Instagram görselleri (PNG, WebP veya 1440 px'ten geniş) bu yolla yayımlanamaz; bunları en fazla 1440 px genişliğinde JPEG olarak dışa aktarın.

## 3. Bilgisayar kapalıyken ne çalışır

| | Bilgisayar kapalı veya uykuda | Bilgisayar açık, MetaDash çalışıyor (tepsi modunda pencere kapalı olabilir) |
|---|---|---|
| **Facebook'ta zamanla** seçili Facebook gönderisi | ✅ Facebook yayımlar | ✅ |
| Instagram, Threads ve bu seçenek olmadan Facebook | ❌ kaçırılır | ✅ |
| **Yayınlayan: Worker** olarak ayarlanan her gönderi ([kendi sunucunuzdaki worker](worker.md)) | ✅ worker yayımlar | ✅ |

- **Facebook'ta zamanla**, gönderiyi hemen Facebook'un kendi zamanlayıcısına devreder. Zaman 10 dakika ile 30 gün arasında ileride olmalıdır. Böyle bir gönderinin ilk yorumu ancak MetaDash çalışırken gönderinin yayına girdiğini gördüğünde eklenir.
- Diğer her şeyi MetaDash kendisi yayımlar; bu yüzden uygulama planlanan zamanda çalışıyor olmalıdır. Pencereyi kapatınca MetaDash'in çalışmaya devam etmesi için **tepsi modunu** (Ayarlar → Arka planda çalışma), isterseniz **oturum açılışında başlatmayı** açın. Kapağı kapatılan dizüstü bilgisayar yine de uykuya geçer.
- Instagram videoları planlanan zamandan 30 dakika, görseller 5 dakika önce hazırlanır; MetaDash o sırada da çalışıyor olmalıdır.

**Kaçırılan gönderiler.** Bilgisayar, gönderinin zamanından 15 dakikadan (**tolerans süresi**) fazla uykuda kaldıysa MetaDash Ayarlar'daki **kaçırılan gönderi politikasını** uygular:

- *Sor* (varsayılan): gönderi kaçırıldı olarak işaretlenir ve bir bildirim kuyruğu açar; orada **Şimdi yayımla**, **Yeniden zamanla** veya **Atla** seçersiniz.
- *Yine de yayımla*: en fazla **Azami gecikme** (varsayılan 180 dakika) kadar geç kaldıysa yayımlar, yoksa kaçırıldı olarak işaretler.
- *Atla*: kaçırıldı olarak işaretler.

## 4. Yayımlama nasıl işler

- Her hesap bir seferde tek gönderi yayımlar; en fazla iki gönderi paralel çalışır.
- Her adım bir sonraki ağ çağrısından önce kaydedilir. MetaDash bir yayımlamanın ortasında kapanırsa, bir sonraki açılışta gönderiyi yeniden göndermek yerine yayına girip girmediğini kontrol eder. Anlayamazsa öğe **"yayına girip girmediği anlaşılamadı"** hatasıyla başarısız olur: hesabı kontrol edin, gönderi yoksa **Yeniden dene**'yi kullanın.
- Geçici hatalar (Meta sunucu hataları, ağ sorunları) 1, 5, 15, 60 ve 180 dakika sonra yeniden denenir, sonra öğe başarısız olur. Hız sınırlarında 15 dakika beklenir. 24 saatlik yayımlama sınırına ulaşıldığında MetaDash 30'ar dakika bekler ve bir uyarı gösterir.
- Süresi dolmuş veya geçersiz bir token o platformda yayımlamayı duraklatır (Instagram ve Facebook, Meta token'ını paylaşır) ve bildirim gösterir. Token'ı yeniledikten sonra yayımlama devam eder.
- **Yayımlamayı duraklat** (Ayarlar veya tepsi) yeni adımları durdurur; çalışmakta olan yayımlama tamamlanır.
- Her adım, Meta hata kodu ve `fbtrace_id` ile birlikte gönderinin günlüğüne yazılır (Meta desteğine bu kimliği iletin).

## 5. Sınırlar

MetaDash bunları zamanlamadan önce kontrol eder. **VERIFY** ile işaretli değerler güncel Meta belgeleriyle doğrulanamadı (veya belgeler çelişiyor); MetaDash temkinli değeri kullanır. Hepsi `src/main/publishing/limits.js` dosyasındadır. Meta geliştirici belgeleriyle 2026-09-29'da karşılaştırıldı. Meta farklı davranırsa [Bilinen sınırlamalar](known-limitations.md) sayfasına bakın ve lütfen bir issue açın.

| | Instagram | Facebook Sayfası | Threads |
|---|---|---|---|
| Açıklama | 2.200 karakter, ≤ 30 hashtag, ≤ 20 bahsetme (VERIFY) | 63.206 (VERIFY) | 500 karakter, ≤ 5 bağlantı, 1 konu etiketi (VERIFY) |
| Görseller | JPEG (PNG/WebP otomatik dönüştürülür), ≤ 8 MB, oran 4:5 – 1,91:1, 320–1440 px genişlik | JPEG/PNG/GIF/BMP/TIFF, ≤ 10 MB (VERIFY) | JPEG/PNG, ≤ 8 MB, oran ≤ 10:1, 320–1440 px genişlik |
| Karusel / albüm | 2–10 öğe (10 belgelenmiş; kodda hâlâ VERIFY işaretli) | 2–10 fotoğraf (VERIFY) | 2–20 öğe |
| Video | Reels MP4/MOV, H.264/HEVC + AAC, 3 sn – 15 dk, ≤ 300 MB, 23–60 fps, 9:16 önerilir | video ≤ 10 GB / 4 sa (1 GB üzeri dosyalar henüz desteklenmiyor); reels 3–90 sn, 9:16 | MP4/MOV, ≤ 5 dk, ≤ 1 GB, 23–60 fps |
| Hikâyeler | görsel ≤ 8 MB veya video 3–60 sn, ≤ 100 MB; açıklama yok sayılır | – | – |
| 24 saatte | 100 gönderi (karusel bir sayılır) | Reels: API ile 30 | 250 gönderi, 1.000 yanıt |
| Platformda zamanlama | – | 10 dk – 30 gün ileri (Meta referansları 30 veya 75 gün diyor; VERIFY) | – |
| Hazırlanan medyanın ömrü | 24 sa | – | 24 sa |

## 6. Sorun giderme

| Mesaj | Ne yapmalı |
|---|---|
| *Bu gönderiye bir medya barındırma gerekiyor* | Bir barındırma ayarlayın (Bölüm 2). |
| *S3 bucket'ına yükleme başarısız oldu (HTTP 403)* | Anahtarlar, bucket adı, bölge veya endpoint yanlış; anahtarın bucket'a yazma izni olmalı. |
| *Medya dosyasına herkese açık erişilemiyor* | "Zaten barındırılıyor" adresi dosyayı döndürmüyor; temel adresi kontrol edin. |
| *Bir izin veya Sayfa rolü eksik olduğu için Meta isteği reddetti* | Bölüm 1'deki izinleri ekleyip token'ı yenileyin; Sayfalar için `CREATE_CONTENT` görevini kontrol edin. |
| *Sayfa için yayımlama token'ı alınamadı* | Sayfayı artık yönetmiyorsunuz ya da token'da `pages_show_list` yok. |
| *Meta medyayı işleyemedi* | Dosya, Meta'nın yükleme sonrası kontrol ettiği bir sınırı aşıyor (codec, bit hızı, oran). Yeniden dışa aktarın (H.264 + AAC, 30 fps, reels için 9:16). |
| *24 saatlik yayımlama sınırına ulaşıldı* | MetaDash otomatik yeniden dener; gönderileri zamana yayın. |
| *Yayına girip girmediği anlaşılamadı* | Hesabı kontrol edin. Yalnızca gönderi yoksa yeniden deneyin. |
| *Kaçırıldı: MetaDash çalışmıyordu* | Kuyruktan yayımlayın, yeniden zamanlayın veya atlayın; tepsi modunu ve oturum açılışında başlatmayı açın. |
