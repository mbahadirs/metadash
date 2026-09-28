# MetaDash için Meta Uygulaması Kurulum Kılavuzu

[English](../meta-app-setup.md)

Bu kılavuz, MetaDash'in Instagram ve reklam verilerini çekebilmesi için gereken Meta (Facebook) uygulamasını sıfırdan oluşturup **kalıcı olarak Development (Geliştirme) modunda** çalıştırmayı anlatır. Hiçbir adımda App Review (uygulama incelemesi), İşletme Doğrulaması veya Live (Canlı) moda geçiş **gerekmez**; çünkü uygulama yalnızca sizin (ve uygulamada rolü olan kişilerin) yönettiği hesaplara erişir.

Meta arayüzü sık değişir; menü adları Türkçe/İngilizce olarak verilmiştir, küçük farklar olabilir. Süre: hesaplar hazırsa yaklaşık 15 dakika.

**İçindekiler**

0. [Başlamadan kontrol listesi](#0-başlamadan-kontrol-listesi)
1. [Instagram hesaplarını hazırlama](#1-instagram-hesaplarını-hazırlama)
2. [Meta uygulamasını oluşturma](#2-meta-uygulamasını-oluşturma)
3. [Ürünleri ve izinleri ekleme](#3-ürünleri-ve-izinleri-ekleme)
4. [Marketing API erişim seviyesi](#4-marketing-api-erişim-seviyesi-reklam-verisi-için)
5. [Ekip arkadaşlarına rol verme](#5-ekip-arkadaşlarına-rol-verme)
6. [Erişim token'ı alma (Graph API Explorer)](#6-erişim-tokenı-alma-graph-api-explorer)
7. [MetaDash tarafında](#7-metadash-tarafında)
8. [Sorun giderme](#8-sorun-giderme)
9. [Sık sorulan sorular](#9-sık-sorulan-sorular)
10. [Faydalı bağlantılar](#10-faydalı-bağlantılar)

---

## 0. Başlamadan kontrol listesi

| Gereksinim | Nasıl kontrol edilir |
| --- | --- |
| Kişisel bir Facebook hesabınız var ve **iki adımlı doğrulama (2FA)** açık | facebook.com → Ayarlar ve gizlilik → Ayarlar → Hesaplar Merkezi → Parola ve güvenlik → İki adımlı doğrulama. Meta, geliştirici hesaplarında 2FA'yı zorunlu tutar; kapalıysa uygulama oluşturma ekranında takılırsınız. |
| Her Instagram hesabı **Profesyonel** (İşletme veya İçerik Üretici) | Instagram uygulaması → Profil → ☰ → Ayarlar ve gizlilik → Hesap türü ve araçlar. "Profesyonel hesaba geç" yazıyorsa hesap henüz kişiseldir. |
| Her Instagram hesabı bir **Facebook Sayfası'na bağlı** | Bölüm 1.2'de anlatılıyor. Sayfa'ya bağlı olmayan hesaplar MetaDash'te soluk gösterilir. |
| Facebook kullanıcınız bu Sayfalarda **Yönetici** (veya Business Manager'da tam denetime sahip) | Sayfa → Ayarlar → Sayfa erişimi. Sayfa başkasına aitse sizi eklemesi gerekir. |
| Reklam verisi istiyorsanız reklam hesaplarında **en az Analist** yetkiniz var | business.facebook.com → Ayarlar → Hesaplar → Reklam hesapları → Kişiler. |

> Ekip arkadaşlarınız da token alacaksa her birinin Meta uygulamasında bir **rolü** olmalı (Bölüm 5). Rolü olmayan kişi Development modundaki uygulamayla giriş yapamaz.

---

## 1. Instagram hesaplarını hazırlama

### 1.1 Profesyonel hesaba geçirme

1. Instagram uygulaması → Profil → ☰ → **Ayarlar ve gizlilik** → **Hesap türü ve araçlar** → **Profesyonel hesaba geç**.
2. **İşletme** (Business) veya **İçerik Üretici** (Creator) seçin; ikisi de çalışır. Kategori seçip devam edin.

### 1.2 Facebook Sayfası'na bağlama (en kritik adım)

MetaDash hesapları `Sayfa → instagram_business_account` bağlantısı (ve `business_management` izniyle Business Manager) üzerinden bulur. Sayfa bağlantısı yoksa insights alınamaz.

**Yol A — Instagram'dan:** Profil → **Profili düzenle** → **Sayfa** (veya Ayarlar → İşletme araçları ve kontrolleri → **Bağlı Facebook Sayfası**) → mevcut Sayfayı seçin ya da yeni oluşturun.

**Yol B — Facebook Sayfası'ndan:** facebook.com → Sayfanız → **Ayarlar** → **Bağlı hesaplar** (Linked accounts) → **Instagram** → **Hesabı bağla** → Instagram'a giriş yapın.

**Yol C — Business Suite'ten (çok sayıda hesap için en pratik yol):** business.facebook.com → **Ayarlar** → **Hesaplar** → **Instagram hesapları** → **Ekle** → Instagram'a giriş → hangi Sayfa ve reklam hesaplarıyla ilişkilendirileceğini seçin.

Doğrulama: Sayfa → Ayarlar → Bağlı hesaplar altında Instagram kullanıcı adı görünmeli.

### 1.3 Sayfa yetkisi

Sayfa → **Ayarlar** → **Sayfa erişimi** (Page access) → adınız **Facebook erişimi olan kişiler** altında **Tam denetim** ile listelenmeli. Business Manager'daki Sayfalar için: business.facebook.com → Ayarlar → Hesaplar → Sayfalar → Sayfayı seçin → Kişiler → kendinizi **Tam denetim** ile ekleyin.

---

## 2. Meta uygulamasını oluşturma

1. **https://developers.facebook.com/** adresine gidin ve Facebook hesabınızla giriş yapın. İlk kez giriyorsanız "Geliştirici olarak kaydol / Register as a developer" adımlarını (ülke, telefon doğrulaması, koşullar) tamamlayın.
2. Sağ üstten **Uygulamalarım / My Apps** → **Uygulama oluştur / Create app**.
3. **"Uygulamanız ne yapacak?" / "What do you want your app to do?"** (kullanım senaryosu) ekranı çıkarsa listenin en altındaki **Diğer / Other**'ı seçip **İleri**'ye basın.
   - Bu ekranda "Instagram" adlı hazır senaryolar da vardır ("Instagram API with Instagram Login" vb.). **Bunları seçmeyin.** MetaDash, Sayfa bağlantılı hesaplarla çalışan Facebook Login akışını kullanır ve "Diğer → İşletme" en esnek yoldur.
4. **Uygulama türü / App type** ekranında **İşletme / Business** seçin → İleri.
5. **Ayrıntılar** ekranı:
   - **Uygulama adı**: örn. `Ekip Analitik` ("Facebook", "Instagram" veya "Meta" kelimelerini içeremez).
   - **Uygulama iletişim e-postası**: sizin e-postanız.
   - **İşletme portföyü / Business portfolio**: Sayfalarınız bir Business Manager'daysa onu seçin; yoksa boş bırakabilirsiniz (sonradan bağlanabilir).
   - **Uygulama oluştur**'a basın, parolanızı girin.
6. Uygulama panosu (App Dashboard) açılır. Sol üstte uygulama adının yanında **Geliştirme / Development** anahtarı görünür. **Bunu asla Canlı/Live'a almayın.**

### 2.1 App ID ve App Secret

1. Sol menü → **Uygulama ayarları / App settings** → **Temel / Basic**.
2. **Uygulama kimliği (App ID)**: 15–16 haneli sayı. Kopyalayın.
3. **Uygulama gizli anahtarı (App Secret)** → **Göster / Show** → Facebook parolanızı girin → 32 karakterlik değeri kopyalayın.
4. Bu iki değeri MetaDash Kurulum sihirbazının **Meta uygulaması** adımına yapıştırın. MetaDash, Secret'ı bilgisayarınızda şifreli saklar; kimseyle paylaşmayın.
5. Bu sayfada başka zorunlu alan **yoktur**. Gizlilik politikası URL'si, uygulama alanları, simge vb. yalnızca Live mod için gerekir.

---

## 3. Ürünleri ve izinleri ekleme

Development modunda izinler için App Review gerekmez; ancak izinlerin uygulamaya **eklenmiş** olması gerekir. Aksi hâlde Graph API Explorer'da seçemezsiniz ya da "Invalid Scopes" hatası alırsınız.

### 3.1 Ürünler

Sol menüde **Ürün ekle / Add product** (veya pano ortasındaki ürün kartları):

1. **Facebook Login for Business** → **Kur / Set up**. Hiçbir şey doldurmanız gerekmez (Geçerli OAuth yönlendirme URI'leri yalnızca kendi web sitenizde giriş yaptıracaksanız gerekir; Graph API Explorer kendi yönlendirmesini kullanır).
2. **Instagram** (bazı panolarda "Instagram Graph API" veya "Instagram API with Facebook Login") → **Kur / Set up**.
3. **Marketing API** → **Kur / Set up**. Reklam verisi istemiyorsanız atlayabilirsiniz.

"İşletme doğrulaması gerekir" benzeri sarı uyarılar görebilirsiniz; bunlar **Advanced Access / Live** içindir. Development modunda kendi varlıklarınız için **Standard Access** yeterlidir; bu uyarıları yok sayın.

### 3.2 İzinleri kullanım senaryosuna ekleme (yeni panolar)

Panonuzun sol menüsünde **Kullanım senaryoları / Use cases** varsa:

1. **Kullanım senaryoları** → oluşturduğunuz senaryonun (genelde "Diğer/Other" veya "Authenticate and request data from users with Facebook Login") yanındaki **Özelleştir / Customize**.
2. **İzinler ve özellikler / Permissions and features** sekmesinde aşağıdaki her iznin yanındaki **Ekle / Add**'e basın:

   | İzin | Ne için gerekli |
   | --- | --- |
   | `instagram_basic` | Instagram profili ve gönderileri (zorunlu) |
   | `instagram_manage_insights` | Hesap, gönderi ve story insights (zorunlu) |
   | `pages_show_list` | Sayfalarınızı listeleme (zorunlu) |
   | `pages_read_engagement` | Sayfa → Instagram bağlantısını okuma (zorunlu) |
   | `ads_read` | Reklam verisi (Kurulum sihirbazı ister; yalnızca reklam hesabı eşlerseniz kullanılır) |
   | `business_management` | Business Manager'a ait Sayfa, Instagram ve reklam hesapları (isteğe bağlı, önerilir) |
   | `instagram_manage_comments` | Yorumlar ve yanıt oranı metrikleri (isteğe bağlı) |

3. Her satırda "Standart erişim / Standard access: Hazır" görünmesi yeterlidir. **"Gelişmiş erişim talep et / Request advanced access" düğmesine basmayın**; App Review'a götürür ve gerekmez.

Eski tip panolarda (**Kullanım senaryoları** menüsü yoksa): **Uygulama incelemesi / App Review** → **İzinler ve özellikler / Permissions and features** → her izni arayın; "Standart erişim" sütununda **Hazır/Ready** yazıyorsa kullanılabilir. Yine "Gelişmiş erişim talep et"e basmayın.

### 3.3 İşletme portföyü bağlantısı (Business Manager kullanıyorsanız)

Uygulama ayarları → **Temel** → en altta **İşletme portföyü / Business portfolio**: Sayfalarınızın ve reklam hesaplarınızın bulunduğu Business Manager'ı seçin. Bu işlem işletme **doğrulaması** (belge yükleme) istemez; yalnızca bağlantı kurar ve `business_management` izninin bu varlıkları görmesini sağlar.

---

## 4. Marketing API erişim seviyesi (reklam verisi için)

Sol menü → **Marketing API** → **Araçlar / Tools** veya **Erişim seviyesi / Access level**. Yeni uygulamalar **Development access** seviyesiyle başlar; bu, yetkiniz olan reklam hesaplarından veri okumaya yeter ve MetaDash tam olarak bunu kullanır. **Standard access** başvurusu yapmanız **gerekmez**.

---

## 5. Ekip arkadaşlarına rol verme

Development modundaki bir uygulamayla yalnızca uygulamada rolü olan kişiler token alabilir.

1. Sol menü → **Uygulama rolleri / App roles** → **Roller / Roles** → **Kişi ekle / Add people**.
2. Kişinin Facebook adını veya e-postasını yazın, rol olarak **Geliştirici / Developer** (veya **Yönetici / Administrator**) seçin.
3. Kişi, daveti Facebook bildirimlerinden ya da developers.facebook.com → Uygulamalarım → **Davetler** üzerinden kabul etmelidir; kabul etmeden token alamaz.
4. Kişinin ayrıca Sayfalarda yönetici ve reklam hesaplarında yetkili olması gerekir (Bölüm 0).

---

## 6. Erişim token'ı alma (Graph API Explorer)

1. **https://developers.facebook.com/tools/explorer/** adresini açın (MetaDash Kurulum sihirbazındaki "Graph API Explorer" düğmesi de buraya götürür).
2. Sağ paneldeki **Meta Uygulaması / Meta App** listesinden uygulamanızı seçin. Listede yoksa farklı bir Facebook hesabıyla giriş yapmışsınızdır ya da daveti kabul etmemişsinizdir.
3. **Kullanıcı veya Sayfa / User or Page** altında **Kullanıcı Token'ı / User Token** seçili kalsın. **Sayfa token'ı seçmeyin.**
4. **İzinler / Permissions** kutusuna tıklayıp şu izinleri ekleyin (MetaDash'teki "Kopyala" düğmesi listeyi verir; arama kutusu virgülle ayrılmış listeyi kabul eder):

   ```
   instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement, ads_read, business_management
   ```

   Yorum modülünü istiyorsanız `instagram_manage_comments` iznini de ekleyin. Bir izin listede çıkmıyorsa Bölüm 3.2'de uygulamaya eklenmemiştir.
5. **Erişim Token'ı Oluştur / Generate Access Token**'a basın. Facebook giriş penceresi açılır:
   - **"[Uygulama] bilgilerinize erişmek istiyor… / [adınız] olarak devam et"** → **Devam et / Continue**.
   - **İşletme portföyü seçimi** çıkarsa Sayfalarınızın bulunduğu portföyü seçin.
   - **"Hangi Sayfaları kullanmak istiyorsunuz?"** → **Tüm mevcut ve gelecekteki Sayfaları etkinleştir / Opt in to all current and future Pages** (veya hepsini işaretleyin).
   - **"Hangi Instagram hesapları…?"** → aynı şekilde **tümünü** seçin.
   - **"Hangi reklam hesapları…?"** → tümünü seçin.
   - İzin özeti ekranında **hepsini açık bırakıp** **Kaydet / Bitti / Done**.
6. **"Bu uygulama geliştirme modunda… / Uygulamanın herkese açılmadan önce incelenmesi gerekir"** benzeri bir ekran görürseniz bu **bilgilendirmedir**: Development modunda uygulamanın yöneticileri, geliştiricileri ve test kullanıcıları için tüm izinler zaten çalışır. **Devam / Tamam** deyip geçin. Hiçbir "incelemeye gönder" düğmesine basmayın; token yine üretilir.
7. Explorer'daki **Erişim Token'ı / Access Token** kutusu dolar (`EAA…` ile başlar). Kopyalayın, MetaDash'in **Token** adımına yapıştırın ve **Dönüştür ve doğrula**'ya basın. MetaDash bunu 60 günlük uzun ömürlü token'a çevirir; verilen izinleri yeşil, eksikleri kırmızı gösterir.

### 6.1 Giriş penceresinde hesaplar gri, eksik ya da yalnızca bir kısmı seçilebiliyor

Facebook'un giriş penceresi çok sayıda varlığı olan kullanıcılarda ilk bakışta yalnızca bir kısmını listeler, geri kalanını aramayla buldurur; bazı hesapları da gri (seçilemez) gösterebilir. Nedenleri ve çözümleri:

| Durum | Neden | Çözüm |
| --- | --- | --- |
| Instagram hesabı gri, "Sayfa'ya bağlı değil" | Hesap profesyonel değil ya da bir Facebook Sayfası'na bağlı değil | Bölüm 1.1 ve 1.2 |
| Instagram hesabı gri, "izniniz yok / yönetici değilsiniz" | Bağlı olduğu Sayfa'da yalnızca kısıtlı bir görev yetkiniz var (örn. yalnızca içerik) | Sayfa sahibi size **Tam denetim** versin (Bölüm 1.3) |
| Hesap hiç listelenmiyor | Farklı bir işletme portföyüne ait | Portföy adımında **doğru portföyü** seçin. Birden fazla portföy varsa her biri için tekrarlayın ya da "tüm mevcut ve gelecekteki" seçeneğini kullanın |
| İlk 20–30 hesaptan sonrası görünmüyor | Pencere kısaltılmış liste gösteriyor | Tek tek seçmek yerine üstteki **"Tüm mevcut ve gelecekteki … etkinleştir / Opt in to all current and future …"** kutusunu işaretleyin. Kutu yoksa her hesabın adını arayıp işaretleyin |
| Bazılarını seçtim, diğerlerini sonradan eklemek istiyorum | İzin bir kez verildi | facebook.com → **Ayarlar ve gizlilik → Ayarlar → İşletme entegrasyonları / Business integrations** → uygulamanız → **Görüntüle ve düzenle** → eksik Sayfa/Instagram/reklam hesaplarını işaretleyip kaydedin. Ardından Explorer'da **yeni token** üretin, MetaDash'te Token adımını tekrarlayın ve Hesap seçimi'nde **Yeniden tara**'ya basın |
| Hesap Business Manager'da ama kişisel Sayfa rolünüz yok | `/me/accounts` bu hesabı döndürmez | MetaDash, `business_management` izniyle Business Manager'daki Sayfaları ve Instagram hesaplarını da tarar; iznin token'da olduğundan emin olun. Yine çıkmıyorsa Business Manager → Kişiler'den o Sayfa/Instagram hesabını kullanıcınıza atayın |
| Hesap "Sayfa yok" rozetiyle geliyor | Instagram hesabı Business Manager'a eklenmiş ama Sayfa'ya bağlanmamış | Bölüm 1.2 Yol C ile Sayfa'ya bağlayın; bağlanana kadar insights alınamaz |

Kontrol için Explorer'da şunları çalıştırın. MetaDash'in Hesap seçimi listesi bu üçünün birleşimidir:

```
me/accounts?fields=name,instagram_business_account{username}&limit=100
me/businesses?fields=name,owned_pages{name,instagram_business_account{username}},client_pages{name,instagram_business_account{username}}
me/businesses?fields=name,owned_instagram_accounts{username},client_instagram_accounts{username}
```

### 6.2 Token'ı Explorer'da hızlıca test etme

Explorer'ın sorgu kutusuna şunu yazıp **Gönder / Submit** deyin:

```
me/accounts?fields=name,instagram_business_account{username,followers_count}&limit=100
```

Her Sayfa için `instagram_business_account` alanı dolu gelmelidir. Bu alanı olmayan Sayfanın Instagram bağlantısı yoktur (Bölüm 1.2). Hiç Sayfa gelmiyorsa giriş penceresinde Sayfaları seçmemişsinizdir: **Generate Access Token**'ı tekrar çalıştırıp hepsini seçin (gerekirse facebook.com → Ayarlar → **İşletme entegrasyonları / Business integrations** altından uygulamayı kaldırıp yeniden izin verin).

Reklam hesapları için:

```
me/adaccounts?fields=name,account_status,currency
```

---

## 7. MetaDash tarafında

1. Kurulum sihirbazı: **Karşılama → Meta uygulaması** (App ID + Secret) **→ Token** (yapıştır, dönüştür) **→ Hesap seçimi** (bulunan Instagram hesapları; müşteri adı ve etiket verin) **→ Reklam hesapları** (isteğe bağlı olarak her birini bir Instagram hesabıyla eşleyin) **→ İlk senkronizasyon**.
2. İlk senkronizasyon onlarca hesap için birkaç dakika sürebilir; ilerleme üst çubukta görünür.
3. Sonrasında verileri üst çubuktaki **Güncelle** düğmesiyle ya da Ayarlar'daki günlük otomatik güncellemeyle tazeleyin.

### 7.1 Token yenileme (yaklaşık 60 günde bir)

Uzun ömürlü token 60 gün geçerlidir. MetaDash, Ayarlar → Bağlantı'da kalan günü gösterir ve Meta 190 hatası döndürdüğünde üstte kırmızı bir uyarı çıkarır. Yenilemek için: Ayarlar → Bağlantı → **Token yenile** (sizi Token adımına götürür) → Bölüm 6'yı tekrarlayın. Mevcut veriler korunur.

---

## 8. Sorun giderme

| Belirti | Neden | Çözüm |
| --- | --- | --- |
| Explorer'da uygulamam listede yok | Farklı Facebook hesabıyla giriş ya da davet kabul edilmemiş | Doğru hesapla girin; Uygulamalarım → Davetler'i kontrol edin |
| İzinler kutusunda `instagram_manage_insights` çıkmıyor | İzin uygulamaya eklenmemiş | Bölüm 3.2 – Kullanım senaryosu → Özelleştir → izni **Ekle** |
| "Invalid Scopes: instagram_manage_insights" | Aynı neden ya da Instagram ürünü eklenmemiş | Bölüm 3.1 ve 3.2 |
| Uygulamanın bu izinleri incelemesiz kullanamayacağını söyleyen ekran | Bilgilendirme (Development modu) | Devam/İleri deyin; incelemeye göndermeyin |
| Giriş penceresinde Sayfa/Instagram listesi boş | Hesap profesyonel değil, Sayfa'ya bağlı değil ya da Sayfa'da yönetici değilsiniz | Bölüm 0 ve 1 |
| `me/accounts` Sayfayı getiriyor ama `instagram_business_account` yok | Sayfa–Instagram bağlantısı yok | Bölüm 1.2 (Yol B veya C) |
| MetaDash: "(#10) Application does not have permission" / kod 10 veya 200 | İzin token'a dahil edilmemiş | Explorer'da izni ekleyip **yeni** token üretin, MetaDash'te tekrar dönüştürün |
| MetaDash: kod 190 "Error validating access token" | Token süresi dolmuş, parola değişmiş ya da uygulama erişimi kaldırılmış | Bölüm 7.1 |
| "(#100) Tried accessing nonexisting field (instagram_business_account)" | `pages_read_engagement` / `instagram_basic` eksik | İzinleri ekleyip yeni token üretin |
| "(#100) Unsupported get request" (media/insights) | Hesap profesyonel değil ya da yeni bağlanmış (insights birkaç saat sonra gelir) | Hesap türünü kontrol edin, birkaç saat sonra tekrar deneyin |
| `me/adaccounts` boş | Reklam hesabında yetkiniz yok ya da giriş penceresinde reklam hesaplarını seçmediniz | Business Manager'da yetki verin; token'ı yeniden üretin |
| "(#4) Application request limit reached" / kod 17, 32, 613 | Geçici istek sınırı | MetaDash otomatik olarak yavaşlar ve yeniden dener; bir saat sonra tekrar deneyin |
| "2500 An active access token must be used" | Token yapıştırılırken kesilmiş | Token'ı Explorer'dan eksiksiz kopyalayın |
| Instagram hesabı başka bir Business Manager'a ait | Yanlış portföy seçilmiş | Giriş penceresinde doğru portföyü seçin; gerekirse uygulamayı o portföye bağlayın (Bölüm 3.3) |
| Uygulama oluştururken "telefon doğrulaması / 2FA" ekranında takıldım | Geliştirici hesabı doğrulanmamış | Hesaplar Merkezi'nde 2FA'yı açın, telefonunuzu doğrulayın, tekrar deneyin |

Meta belirli bir metriği reddettiğinde (o metrik için 100 hata kodu), MetaDash onu sonraki isteklerden çıkarır ve Ayarlar'da listeler; oradan daha sonra yeniden etkinleştirebilirsiniz.

---

## 9. Sık sorulan sorular

**Uygulamayı Live (Canlı) moda almam gerekir mi?**
Hayır. Live mod uygulamayı ekibiniz dışındaki kullanıcılara açar ve inceleme/doğrulama ister. MetaDash yalnızca uygulamada rolü olan kişilerin varlıklarını okur.

**"İşletme doğrulaması gerekli" uyarısı görüyorum.**
Advanced Access içindir. Kendi varlıklarınıza Standard Access ile erişmek için gerekmez.

**Birden fazla Business Manager'ım var.**
Hepsine erişimi olan tek bir Facebook kullanıcısıyla token alın ve giriş penceresinde her portföydeki Sayfaları seçin.

**Müşteri, Sayfasına beni eklemek istemiyor.**
Müşteri, kendi Business Manager'ına işletmenizi **Ortak (Partner)** olarak ekleyip Sayfa ve Instagram hesabı için içerik/analiz görevleri verebilir. Yönetici olmanız şart değildir; ancak `instagram_manage_insights` için hesabın size görünür olması gerekir.

**Instagram hesabı Sayfa olmadan (yalnızca Instagram Login ile) bağlanabilir mi?**
Bu sürümde hayır; MetaDash Sayfa bağlantılı akışı kullanır.

**Aynı Meta uygulamasını ve token'ı başka bir bilgisayarda kullanabilir miyim?**
Evet. Meta uygulaması istediğiniz sayıda MetaDash kurulumunda kullanılabilir; her kurulum token'ın kendi kopyasını o bilgisayara bağlı bir anahtarla şifreleyerek saklar. Sırlar dahil tüm veriyi taşımak için Ayarlar → Veri taşıma'yı bir parolayla kullanın.

**App Secret sızarsa ne yapmalıyım?**
Uygulama ayarları → Temel → **Sıfırla / Reset** ile yeni Secret üretin, MetaDash'e girin ve yeni token alın.

---

## 10. Faydalı bağlantılar

- Uygulama panosu: https://developers.facebook.com/apps/
- Graph API Explorer: https://developers.facebook.com/tools/explorer/
- Access Token Debugger (izin ve süre kontrolü): https://developers.facebook.com/tools/debug/accesstoken/
- Business Suite ayarları (Instagram–Sayfa–reklam hesabı bağlantıları): https://business.facebook.com/settings/
- İzin referansı: https://developers.facebook.com/docs/permissions/
- Instagram API with Facebook Login: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/
