# MetaDash için YouTube Kurulum Rehberi

[English](../youtube-setup.md)

MetaDash **kendi** YouTube kanallarınızı Google'ın resmî API'leriyle okur: **YouTube Data API v3** (kanal, videolar,
yorumlar) ve **YouTube Analytics API** (görüntülenme, izlenme süresi, ortalama izlenme süresi, kazanılan/kaybedilen
aboneler, beğeni, yorum, paylaşım, izleyici demografisi). MetaDash'in sunucusu ya da ortak bir Google uygulaması yoktur:
Google Cloud'da kendi OAuth istemcinizi (ücretsiz) oluşturursunuz, MetaDash bu bilgisayarda onunla oturum açar.

Google konsolu sık değişir; menü adları biraz farklı olabilir. Yaklaşık 15 dakika sürer.

**İçindekiler**

1. [Google Cloud projesi oluşturun ve API'leri etkinleştirin](#1-google-cloud-projesi-oluşturun-ve-apileri-etkinleştirin)
2. [OAuth onay ekranını yapılandırın](#2-oauth-onay-ekranını-yapılandırın)
3. ["Masaüstü uygulaması" türünde OAuth istemcisi oluşturun](#3-masaüstü-uygulaması-türünde-oauth-istemcisi-oluşturun)
4. [Kanalları MetaDash'e bağlayın](#4-kanalları-metadashe-bağlayın)
5. [Yorumlara yanıt verme (isteğe bağlı)](#5-yorumlara-yanıt-verme-isteğe-bağlı)
6. [Kota](#6-kota)
7. [MetaDash neleri toplar, sınırlar](#7-metadash-neleri-toplar-sınırlar)
8. [Gizlilik, bağlantıyı kesme ve verileri silme](#8-gizlilik-bağlantıyı-kesme-ve-verileri-silme)
9. [Sorun giderme](#9-sorun-giderme)

---

## 1. Google Cloud projesi oluşturun ve API'leri etkinleştirin

1. [console.cloud.google.com](https://console.cloud.google.com/) adresini açın ve herhangi bir Google hesabıyla oturum
   açın (kanalların sahibi olması gerekmez).
2. Üst çubuktaki proje seçici → **Yeni proje** → ör. `MetaDash` → **Oluştur**, ardından projeyi seçin.
3. **API'ler ve Hizmetler → Kitaplık**: şu ikisini bulup **Etkinleştir**'e tıklayın:
   - **YouTube Data API v3**
   - **YouTube Analytics API**

## 2. OAuth onay ekranını yapılandırın

1. **API'ler ve Hizmetler → OAuth izin ekranı** (yeni konsollarda: **Google Auth Platform → Markalama / Kitle**).
2. Kullanıcı türü **Harici** (tüm kanallar Google Workspace kuruluşunuza aitse **Dahili**).
3. Uygulama adı `MetaDash (yours)`, destek ve geliştirici iletişimi olarak e-postanız. Logo veya alan adı gerekmez.
4. **Kapsamlar / Veri erişimi**: eklemeniz gerekmez, MetaDash bunları zaten ister:
   - `.../auth/youtube.readonly` — kanal, videolar ve yorumlar (okuma)
   - `.../auth/yt-analytics.readonly` — YouTube Analytics raporları
   - `.../auth/youtube.force-ssl` — yalnızca MetaDash'ten yorumlara yanıt vermek / moderasyon yapmak isterseniz
5. **Yayınlama durumu — önemli:**
   - Uygulama **Test** durumundayken yalnızca **Test kullanıcıları** listesindeki Google hesapları oturum açabilir ve
     Google'ın verdiği yenileme belirteçleri **7 gün sonra sona erer**. MetaDash her hafta yeniden bağlanmanızı ister.
   - **Uygulamayı yayınla**'ya tıklayın (durum **Üretimde**). Uygulama doğrulanmadığı için onay ekranında
     "doğrulanmamış uygulama" uyarısı çıkar; **Gelişmiş → MetaDash'e git (güvenli değil)**'i seçin. Kendi özel
     istemciniz için bu beklenen bir durumdur. Doğrulanmamış uygulamalar 100 kullanıcıyla sınırlıdır; kendi kanallarınız
     için fazlasıyla yeterli.
   - Test durumunda kalmak isterseniz her kanal sahibinin Google hesabını **Test kullanıcısı** olarak ekleyin ve haftalık
     yeniden bağlanmayı bekleyin.

## 3. "Masaüstü uygulaması" türünde OAuth istemcisi oluşturun

1. **API'ler ve Hizmetler → Kimlik bilgileri → Kimlik bilgisi oluştur → OAuth istemci kimliği** (veya **Google Auth
   Platform → İstemciler → İstemci oluştur**).
2. Uygulama türü: **Masaüstü uygulaması**. Ad: `MetaDash`. **Oluştur**.
3. **İstemci kimliğini** (`…apps.googleusercontent.com`) ve **istemci gizli anahtarını** (`GOCSPX-…`) kopyalayın.
   Masaüstü istemcisinin gizli anahtarı gerçekte gizli sayılmaz (Google da böyle belirtir), MetaDash yine de şifreli saklar.
4. Yönlendirme URI'si kaydetmeniz gerekmez: masaüstü istemcileri herhangi bir `http://127.0.0.1:<port>` adresine
   yönlendirebilir; MetaDash da bunu kullanır (tek seferlik yerel dinleyici, PKCE ile).

## 4. Kanalları MetaDash'e bağlayın

1. **Ayarlar → Bağlantılar → YouTube → Google OAuth istemcisi**: istemci kimliğini ve gizli anahtarı yapıştırın → **Kaydet**.
2. **Kanal bağla**'ya tıklayın. Tarayıcınızda Google onay ekranı açılır:
   - Google hesabını, ardından **kanalı** seçin (marka hesapları kanal seçicide görünür);
   - istenen erişime izin verin. Tarayıcı "Bu sekmeyi kapatabilirsiniz" gösterir.
3. Kanal listede görünür ve takip edilir. Her ek kanal için **Kanal bağla**'yı tekrarlayın; her kanalın kendi belirteci
   olur, süresi dolan bir kanal diğerlerini engellemez.
4. Senkronizasyon çalıştırın. İlk senkronizasyon bir yıla kadar günlük Analytics verisini ve yüklemelerinizi okur.

İçerik sahibi (CMS / MCN) raporları desteklenmez.

## 5. Yorumlara yanıt verme (isteğe bağlı)

Yorumları okumak için `youtube.readonly` yeterlidir. MetaDash gelen kutusundan yanıt vermek (veya yorum gizlemek) için
kanalın yanındaki **Yanıtlamayı etkinleştir**'e tıklayın. MetaDash yalnızca o kanal için Google'dan `youtube.force-ssl`
dahil yeniden izin ister. Yanıtlar asla otomatik gönderilmez — her birini siz onaylarsınız.

## 6. Kota

Her Google Cloud projesi YouTube Data API için günde **10.000 birim** kota alır; kota **Pasifik saatiyle gece
yarısı** sıfırlanır. Liste çağrıları (kanal, yüklemeler, videolar, yorum sayfaları) 1 birim; yanıt göndermek veya bir
yorumun moderasyon durumunu değiştirmek 50 birimdir. MetaDash `search.list` kullanmaz.

Bir kanalın senkronizasyonu yaklaşık `1 + 2 × ⌈video ÷ 50⌉` birim, artı yorumları okunan her video için bir birim
tutar — 300 videolu bir kanal yaklaşık 13 birim. MetaDash her OAuth istemcisi için bir defter tutar (Ayarlar'da görünür):

- okumalar günlük sınırın %90'ında durur, böylece yanıtlar için en az 500 birim boş kalır;
- Google `quotaExceeded` bildirirse YouTube işleri o gün için bir uyarıyla durur; diğer platformlar senkronize olmaya devam eder.

YouTube Analytics API'nin ayrı bir kotası vardır ve sayılmaz.

Daha fazlası gerekirse Google Cloud'dan kota artışı isteyin (YouTube API Services denetimi) — bir ekibin kendi
kanalları için varsayılan genellikle yeterlidir.

## 7. MetaDash neleri toplar, sınırlar

| Veri | Kaynak | Notlar |
|---|---|---|
| Abone, video sayısı | `channels.list` | Google abone sayısını üç anlamlı basamağa aşağı yuvarlar; gizli sayılar boş kalır. Net abone değişimi Analytics'ten gelir (kesin). |
| Videolar | yüklemeler oynatma listesi + `videos.list` | Başlık + açıklama (metin), süre, küçük resim, canlı/Shorts/video türü. |
| Video başına | `videos.list` istatistikleri + Analytics | Görüntülenme, beğeni, yorum (anlık), paylaşım, izlenme süresi, ortalama izlenme süresi ve yüzdesi. |
| Gün başına | Analytics `dimensions=day` | Görüntülenme, izlenme süresi, ort. izlenme süresi, beğeni, yorum, paylaşım, kazanılan/kaybedilen abone. |
| Demografi (haftalık) | Analytics | İzleyici yaş × cinsiyet (yüzde) ve ülkelere göre görüntülenme (son 28 gün). Küçük kanallar hiç almayabilir. |
| Yorumlar | `commentThreads.list` | Birleşik gelen kutusu için; kanal sahibinin yanıtları kanal kimliğiyle tanınır. |

- **Gecikme:** YouTube Analytics verileri 2–3 gün gecikmeli gelir ve düzeltilir; MetaDash her senkronizasyonda son 7 günü
  yeniden okur. Son günler Google doldurana kadar düşük görünür.
- **Shorts:** Data API'de "Shorts mu" bilgisi yoktur. MetaDash her videonun içerik türünü (Shorts / video / canlı)
  Analytics'e sorar. Analytics'te henüz veri olmayan videolarda 3 dakikaya kadar olanlar Shorts sayılır.
- YouTube'da erişim, kaydetme ve hikâye yoktur; bu kutucuklar gizlenir.

## 8. Gizlilik, bağlantıyı kesme ve verileri silme

- Her şey yalnızca bu bilgisayarda, MetaDash veritabanında saklanır. Belirteçler ve istemci gizli anahtarı şifrelidir.
- MetaDash'in YouTube verisi kullanımı [YouTube API Hizmetleri Hizmet Şartları](https://developers.google.com/youtube/terms/api-services-terms-of-service)
  ve [Google Gizlilik Politikası](https://policies.google.com/privacy)'na tabidir. Veriler yalnızca size ve dışa
  aktardığınız raporlarda gösterilir.
- **Bağlantıyı kes** (Ayarlar → Bağlantılar → YouTube), MetaDash'in Google'daki erişimini iptal eder ve "Bu kanalın
  verilerini MetaDash'ten de sil" açıkken (varsayılan) kanalı, videolarını, metriklerini, yorumlarını ve demografisini
  MetaDash'ten siler. Geçmişi korumak için anahtarı kapatın (kanal yalnızca takipten çıkarılır).
- Google'ın API politikaları, saklanan API verilerinin 30 gün içinde yenilenmesini veya silinmesini ister. Bir kanal 30
  gündür senkronize olmadıysa MetaDash uyarı gösterir: yeniden senkronize edin ya da bağlantıyı kesip verilerini silin.
- MetaDash'in erişimini kendiniz de [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
  (Üçüncü taraf uygulamalar ve hizmetler) adresinden kaldırabilirsiniz.

## 9. Sorun giderme

| Belirti | Neden / çözüm |
|---|---|
| "Erişim engellendi: uygulama doğrulamayı tamamlamadı" / "access_denied" | Onay ekranı Test durumunda ve Google hesabınız test kullanıcısı değil — ekleyin ya da uygulamayı yayınlayın (bölüm 2). |
| Her 7 günde bir yeniden bağlanmak gerekiyor | Onay ekranı hâlâ **Test** durumunda. Yayınlayın (bölüm 2) ve bir kez yeniden bağlanın. |
| "invalid_client" | İstemci kimliği/gizli anahtar yanlış ya da istemci **Masaüstü uygulaması** türünde değil. Masaüstü istemcisi oluşturup yeniden kaydedin. |
| "Bu Google hesabının YouTube kanalı yok" | Onay ekranında yalnızca Google hesabını değil, kanalı (veya marka hesabını) seçin. |
| "Oturum açma zaman aşımına uğradı" | Tarayıcı 5 dakika içinde dönmedi. **Kanal bağla**'ya yeniden tıklayın. |
| Demografi yok | Google, trafiği az olan kanallarda demografiyi paylaşmaz. |
| "Bugünkü YouTube API kotası doldu" | Pasifik saatiyle gece yarısını bekleyin ya da OAuth istemcisi başına kanal sayısını azaltın (her Cloud projesinin kendi 10.000 birimi vardır). |
| Kanalda "Oturumun süresi doldu veya iptal edildi" | Erişim Google'da iptal edildi, parola değişti ya da belirteç 6 ay kullanılmadı. **Yeniden bağlan**'a tıklayın. |
| Son günlerin izlenme süresi YouTube Studio'dan farklı | Analytics gecikmesi (2–3 gün); kendiliğinden düzelir. |
