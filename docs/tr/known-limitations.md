# Bilinen sınırlamalar

[English](../known-limitations.md)

Bu sayfa MetaDash 2.0'ın yapamadıklarını ve resmî belgelerden tam olarak doğrulayamadığımız platform API davranışlarına nerede dayandığını listeler. Platformlar API'lerini sık değiştirir. Aşağıdakilerden biri gördüğünüzle uyuşmuyorsa lütfen [bir issue açın](https://github.com/mbahadirs/metadash/issues/new); platformu, ne yaptığınızı, MetaDash'in ne gösterdiğini ve mümkünse senkronizasyon günlüğündeki veya gönderi günlüğündeki hata kodunu ve `fbtrace_id` değerini ekleyin. Issue'lara asla token veya sır yapıştırmayın.

## Genel

| Sınırlama | Ayrıntılar |
| --- | --- |
| **İmzasız paketler** | Sürüm paketleri yalnızca imzalama sırları tanımlıysa imzalanır; bu yüzden macOS Gatekeeper ve Windows SmartScreen ilk açılışta uyarı verebilir. Bkz. [Kod imzasız paketler](../../README.tr.md#kod-imzasız-paketler). macOS'ta ve `.deb` paketinde güncellemeler otomatik kurulmaz. |
| **Arka planda yayımlama MetaDash'in çalışmasını gerektirir** | MetaDash'in gönderdiği Instagram, Threads ve Facebook gönderileri yalnızca uygulama çalışırken (tepsi modunda pencere kapalı olabilir) ve bilgisayar uyanıkken yayımlanır. [Kendi sunucunuzdaki worker'ı](worker.md) kullanmıyorsanız, bilgisayar kapalıyken yalnızca **Facebook'ta zamanla** seçilmiş Facebook gönderileri yayımlanır. Bkz. [Yayımlama kurulumu, bölüm 3](publishing-setup.md#3-bilgisayar-kapalıyken-ne-çalışır). |
| **Instagram görselleri ve Threads için herkese açık medya barındırıcısı** | Meta, Instagram görsellerini ve tüm Threads medyasını herkese açık bir adresten indirir. Kendi S3 uyumlu depolama alanınız (veya deneysel Facebook Sayfası barındırıcısı ya da zaten barındırdığınız dosyalar) gerekir. Bkz. [Yayımlama kurulumu, bölüm 2](publishing-setup.md#2-medya-barındırma-instagram-ve-threads). |
| **Yayımlama yapılabilen platformlar** | Yayımlama Instagram, Facebook Sayfaları ve Threads için vardır. YouTube ve TikTok yalnızca analitiktir (YouTube'da ayrıca gelen kutusu). |
| **Doğrudan mesaj yok** | Gelen kutusu yalnızca yorumları işler. Instagram ve Facebook mesajlaşması ek izinler, App Review ve webhook gerektirir. |
| **Yapay zekâ özellikleri beta** | Yapay zekâ özellikleri varsayılan olarak kapalıdır ve kendi API anahtarınızı veya yerel bir Ollama modelini gerektirir. Taklit sağlayıcılarla ve sınırlı sayıda gerçek modelle test edilmiştir. Token ve maliyet rakamları tahminidir. |
| **Ekip rolleri korkuluktur** | Roller ve müşteri görünümü bir güvenlik sınırı değildir. Bkz. [Ekip](team.md). |
| **Diller** | İngilizce ve Türkçe eksiksizdir. Almanca ve İspanyolca kısmidir; çevrilmemiş metinler İngilizce görünür. |
| **Özel günler** | İçerik fikirlerindeki özel günler listesi yaklaşıktır. Ramazan ve dinî bayramlar 2026–2028 için küçük bir tablodan gelir ve bir gün sapabilir; Diyanet takvimiyle karşılaştırın. |
| **macOS'ta oturum açılışında başlatma** | macOS 13 ve sonrasında macOS, bir uygulamanın oturum açılışında başlatıldığını artık bildirmez. MetaDash, açılıştan sonraki 5 dakika içindeki bir başlatmayı oturum açılışı başlatması sayar ("Oturum açılışında gizli başlat" için). |

## Instagram

| MetaDash'in varsayımı | Farklı bir şey görürseniz |
| --- | --- |
| Bir açıklamada en fazla **20 @bahsetme** olabilir. | Meta daha az bahsetmeli bir gönderiyi reddeder veya daha fazlasını kabul eder. |
| Bir karusel **2–10 öğe** içerebilir ve karusel videoları en fazla **60 saniye** olabilir. | Geçerli bir karusel reddedilir veya daha uzun karusel videoları kabul edilir. |
| Bir yorum yanıtı en fazla **2.200 karakter** (açıklama sınırı) olabilir. Meta ayrı bir sınır belgelemez. | 2.200 karakterden kısa bir yanıt uzunluğu nedeniyle reddedilir. |
| Instagram görselleri herkese açık bir adresten alınmalıdır ve imzalı S3 bağlantıları (sorgu dizesi içeren) çalışır. | Meta imzalı bağlantıları reddeder. Geçici çözüm olarak depolama alanınız için **Herkese açık temel URL** ayarlayın ([Yayımlama kurulumu, 2.1](publishing-setup.md#21-cloudflare-r2-adım-adım)). |

MetaDash en iyi uygulama olarak 3–5 hashtag önerir; Instagram 30'a izin verir. Bu bir öneridir, API sınırı değildir.

## Facebook Sayfaları

| MetaDash'in varsayımı | Farklı bir şey görürseniz |
| --- | --- |
| Bir Sayfa gönderisinin açıklaması en fazla **63.206 karakter** olabilir. | Uzun açıklamalar bu uzunluğun altında reddedilir. |
| Fotoğraflar en fazla **10 MB** olabilir (bazı Meta sayfaları 4 MB der). | 4 ile 10 MB arasındaki fotoğraflar yüklenemez. |
| Bir albümde en fazla **10 fotoğraf** olabilir (pratik `attached_media` sınırı). | Daha fazla fotoğraflı albümler çalışır veya 10 fotoğraf başarısız olur. |
| **Facebook'ta zamanla**, **10 dakika ile 30 gün** sonrası arasındaki bir zamanı kabul eder (Meta'nın başvuru belgeleri 30 veya 75 gün der). | Daha ileri zamanlar kabul edilir veya 30 günden kısa zamanlar reddedilir. |
| Zamanlanmış gönderilerin albüm fotoğrafları `temporary=true` ile yüklenir; zamanlanmış videolar video nesnesi üzerinden eşleştirilir ve yeniden zamanlanır. | Facebook'ta zamanlanmış bir albüm veya video eksik, çift ya da yeniden zamanlanamıyor. |
| Bir yorumu gizlemek `pages_manage_engagement` gerektirir. | Bu izni verdiğiniz hâlde gizleme bir izin hatasıyla başarısız olur. |
| Bir yorum yanıtı en fazla **8.000 karakter** olabilir. | 8.000 karakterden kısa yanıtlar uzunluk nedeniyle reddedilir. |

## Threads

| MetaDash'in varsayımı | Farklı bir şey görürseniz |
| --- | --- |
| Bir gönderi 500 karakter içinde en fazla **1 konu etiketi** ve **5 bağlantı** içerebilir. | Meta daha fazlasını kabul eder veya daha azını reddeder. |
| `alt_text`, görsel ve video kapsayıcılarında kabul edilir. | Alternatif metinli gönderiler başarısız olur veya alternatif metin Threads'te görünmez. |
| Gelen kutusundan yanıt vermek `threads_manage_replies` ve `threads_content_publish` gerektirir. MetaDash bir yanıtı yayımlamadan önce 30 saniyeye kadar bekler (metin yanıtları genellikle hemen hazırdır). | Yanıtlar bir izin hatasıyla başarısız olur veya çok daha uzun sürer. |

## YouTube

| MetaDash'in varsayımı | Farklı bir şey görürseniz |
| --- | --- |
| YouTube Analytics video bazlı sorguları kabul eder (`dimensions=video` ve bir video kimliği listesi, çağrı başına en fazla 200). Google reddederse MetaDash, Data API'deki herkese açık istatistiklere geri döner. | Tüm videolarda izlenme süresi veya ortalama izleme süresi eksik. |
| Analytics her videonun içerik türünü (Shorts, video, canlı yayın) bildirebilir. Bildiremezse 3 dakikaya kadar olan videolar Shorts sayılır. | Shorts yanlış sınıflandırılır. |
| Yüklemeler oynatma listesi videoları en yeniden eskiye sıralar. | Bir senkronizasyondan sonra eski videolar eksik. |
| Yorum konuları yanıtların yalnızca bir kısmını içerir; MetaDash kalanını ayrıca çeker. | Gelen kutusunda yanıtlar eksik veya çift. |
| "Gizle", yorumu incelemeye almak (`heldForReview`), "göster" ise yeniden yayımlamaktır. İkisi de `youtube.force-ssl` kapsamını gerektirir. | Gizlenen yorumlar YouTube Studio'da farklı davranır. |
| Bir yorum yanıtı en fazla **10.000 karakter** olabilir. | Daha kısa yanıtlar uzunluk nedeniyle reddedilir. |
| Analytics API kotası, günlük 10.000 Data API biriminden ayrıdır. Hız sınırı hataları beklemeli olarak yeniden denenir. | Senkronizasyonlar MetaDash'in açıklamadığı bir kota hatasıyla durur. |
| Günlük Analytics satırları 2–3 gün gecikmeli gelir ve düzeltilir; bu yüzden MetaDash son 7 günü yeniden okur. | Daha eski günler bir haftadan sonra da değişmeye devam eder. |

Diğer YouTube sınırları: OAuth onay ekranınız **Testing** (Test) durumundayken Google yenileme token'ları **7 gün** sonra sona erer ve her hafta yeniden bağlanmanız gerekir; bunu önlemek için onay ekranını yayımlayın ([YouTube kurulumu, bölüm 2](youtube-setup.md#2-oauth-onay-ekranını-yapılandırın)). Her Google Cloud projesinin günlük **10.000 Data API birimi** vardır. İçerik sahibi (CMS/MCN) raporları desteklenmez.

## TikTok (deneysel)

TikTok'un Display API'si üçüncü taraf uygulamalara Meta veya Google'dan çok daha az veri verir. Günlük analitik, erişim, izlenme süresi, demografi veya yorum yoktur. MetaDash günlük görüntülemeleri ve yeni takipçileri senkronizasyonlar arasındaki farklardan **tahmin eder**. Sandbox uygulamalar 10 hedef kullanıcıyla sınırlıdır. Bkz. [TikTok kurulumu](tiktok-setup.md).

| MetaDash'in varsayımı | Farklı bir şey görürseniz |
| --- | --- |
| Sandbox uygulamalar hedef kullanıcıları için gerçek sayılar döndürür. | Sandbox modunda tüm sayılar sıfır veya sahte. |
| Fotoğraf gönderileri video listesinde yer almaz (veya video olarak görünür). | Fotoğraf gönderileri yanlış sayılarla görünür ya da bir senkronizasyonu bozar. |
| Kendi videolarınızın `view_count` değeri herkese açık oynatma sayısına eşittir. | MetaDash'teki görüntülemeler TikTok uygulamasındakinden farklı. |
| `http://127.0.0.1:*/callback/` yönlendirmesi MetaDash'in seçtiği her yerel portla eşleşir. | Oturum açma bazı denemelerde `redirect_uri` hatasıyla başarısız olur. |
| Kod yapıştırma yedeği (HTTPS geri dönüş sayfalı Web platformu) PKCE ile çalışır. TikTok PKCE'yi yalnızca masaüstü ve mobil için belgeler. | Kod bir *code verifier* hatasıyla reddedilir. Bunun yerine loopback oturum açmayı kullanın. |

## Meta, platformlar arası

| MetaDash'in varsayımı | Farklı bir şey görürseniz |
| --- | --- |
| Meta açıklama uzunluğunu MetaDash gibi sayar: emojiler tek karakter sayılır ve MetaDash sınıra yaklaşıldığında uyarır. | MetaDash'in kabul ettiği bir açıklama çok uzun diye reddedilir. |
| Hata alt kodları: 2207042 günlük yayımlama sınırı, 2207008 ve 2207020 süresi dolmuş medya, 2207001, 2207003, 2207032 ve 2207053 geçici hatalardır. Meta bunları yalnızca kısmen belgeler. | Başarısız olması gereken bir gönderi yeniden denenir ya da yeniden denemeyle başarılı olacak bir gönderi başarısız olur. |
| Facebook ve Threads'te ilk yorumlar [Yayımlama kurulumu](publishing-setup.md#1-izinler) sayfasında listelenen kapsamları gerektirir. | Gönderi yayımlanır ama ilk yorum reddedilir. |
| Worker, [worker.md](worker.md#worker-neleri-alır-ve-neleri-asla-almaz) sayfasında listelenen en düşük yayımlama kapsamlarına sahip bir token'ı kabul eder. | Worker bu kapsamlara sahip bir token'ı reddeder ya da yayımlama bu token'la başarısız olur. |

## Yapay zekâ sağlayıcıları

| MetaDash'in varsayımı | Farklı bir şey görürseniz |
| --- | --- |
| Listedeki her Claude modeli görsel kabul eder. OpenAI modelleri adlarına göre görsel destekli sayılır; Gemini 1.5 ve sonrası çok kiplidir. | "Modeliniz görsel göremiyor" uyarısı modeliniz için yanlış, ya da görselli istekler başarısız oluyor. Bir model görselleri reddederse MetaDash isteği görselsiz yeniden dener. |
| OpenAI JSON şeması yanıtlarını, Gemini JSON modunu, Ollama 0.5 ve sonrası yapılandırılmış çıktıları destekler. | Stüdyo özellikleri, modelin yanıtı yanlış biçimde olduğu için başarısız olur. Ollama daha eskiyse güncelleyin. |
| Token tahminleri token başına yaklaşık 4 karakter kullanır (Türkçe metin daha yoğundur) ve görsel token maliyetleri her sağlayıcının yayımladığı formülü izler. | Maliyet tahmini sağlayıcınızın faturasından çok farklı. Fiyatlar güncelliğini yitirebilecek yerleşik bir tablodan gelir. |
