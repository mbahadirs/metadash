# MetaDash için Threads Kurulum Rehberi

[English](../threads-setup.md)

MetaDash, **kendi** Threads profillerinizin gönderilerini ve istatistiklerini resmi Threads API üzerinden okur.
Threads'in uygulama bilgileri ve erişim token'ı, [meta-app-setup.md](meta-app-setup.md) dosyasında anlatılan Meta
(Instagram/Facebook) bağlantısından ayrıdır. Uygulama **Geliştirme modunda** kalabilir: uygulamada rolü olan kişiler
(siz ve Threads test kullanıcılarınız) Uygulama İncelemesi olmadan bağlanabilir.

Meta arayüzü sık değişir; menü adları biraz farklı olabilir. Yaklaşık 10 dakika sürer.

**İçindekiler**

1. [Threads kullanım senaryosuyla uygulama oluşturun](#1-threads-kullanım-senaryosuyla-uygulama-oluşturun)
2. [Threads App ID ve App Secret](#2-threads-app-id-ve-app-secret)
3. [Threads hesabını test kullanıcısı olarak ekleyin](#3-threads-hesabını-test-kullanıcısı-olarak-ekleyin)
4. [Yönlendirme adresi](#4-yönlendirme-adresi)
5. [MetaDash'te bağlanın (kod veya token)](#5-metadashte-bağlanın)
6. [Token süresi ve otomatik yenileme](#6-token-süresi-ve-otomatik-yenileme)
7. [MetaDash'in topladığı veriler ve sınırlar](#7-metadashin-topladığı-veriler-ve-sınırlar)
8. [Sorun giderme](#8-sorun-giderme)

---

## 1. Threads kullanım senaryosuyla uygulama oluşturun

1. [developers.facebook.com/apps](https://developers.facebook.com/apps) → **Uygulama oluştur**.
2. Kullanım senaryosu sorulduğunda **Access the Threads API** (Threads API'ye erişim) seçin. Mevcut bir uygulamaya da
   ekleyebilirsiniz (Uygulama Paneli → **Kullanım senaryoları** → **Kullanım senaryosu ekle**).
3. **Kullanım senaryoları** → **Access the Threads API** → **Özelleştir** (veya **İzinler**) bölümünde şu izinlerin
   ekli olduğundan emin olun:
   - `threads_basic` (profil ve gönderiler, her zaman gerekli)
   - `threads_manage_insights` (görüntülenme, beğeni, yanıt, yeniden paylaşım, alıntı, takipçi, demografi)

   İsteğe bağlı: Planlayıcı'dan yayımlamak için `threads_content_publish` ve `threads_manage_replies`
   ([publishing-setup.md](publishing-setup.md)), birleşik gelen kutusunda yanıtları okumak için `threads_read_replies`
   ([inbox.md](inbox.md)). MetaDash bunları yalnızca Ayarlar → Bağlantılar'da **Paylaşım iznini de iste** açıkken
   ister.

## 2. Threads App ID ve App Secret

Threads kullanım senaryosu olan bir uygulamada **iki** App ID ve secret bulunur. MetaDash **Threads** olanlara ihtiyaç
duyar: Uygulama Paneli → **Uygulama ayarları** → **Temel**, **Threads App ID** / **Threads App Secret** başlıklı
bölüm (üstteki Facebook App ID değil). Secret'ı görmek için **Göster**'e tıklayın.

MetaDash secret'ı bu bilgisayarda şifreli saklar; yalnızca token alınırken veya yenilenirken Threads'e gönderilir.

## 3. Threads hesabını test kullanıcısı olarak ekleyin

Geliştirme modunda yalnızca uygulamada rolü olan hesaplar bağlanabilir.

1. Uygulama Paneli → **Uygulama rolleri** → **Roller** → **Kişi ekle** → **Threads Tester** seçip Threads kullanıcı
   adını girin.
2. O Threads hesabıyla giriş yapın (uygulama veya threads.com) → **Ayarlar** → **Hesap** → **Web sitesi izinleri** →
   **Davetler** → daveti kabul edin.

## 4. Yönlendirme adresi

Uygulama Paneli → **Kullanım senaryoları** → **Access the Threads API** → **Ayarlar** → **Redirect Callback URLs**.
Adres `https://` ile başlamalı ve birebir eşleşmelidir (sondaki `/` işaretine dikkat). MetaDash `https://localhost/`
önerir: orada bir şey çalışması gerekmez, kodu tarayıcının adres çubuğundan kopyalarsınız. Meta `localhost`'u kabul
etmezse, kontrol ettiğiniz herhangi bir https adresini kullanın. Aynı adresi MetaDash'e girin.

## 5. MetaDash'te bağlanın

**Kurulum → Threads** (veya **Ayarlar → Bağlantılar → Threads**) ekranını açıp Threads App ID ve App Secret'ı
kaydedin. Ardından şunlardan birini kullanın:

**A. Yetkilendirme kodu (önerilen)**

1. **Threads girişini aç**'a tıklayın. Tarayıcı, uygulamanız için `threads_basic` ve `threads_manage_insights`
   izinleriyle `threads.com/oauth/authorize` sayfasını açar.
2. Giriş yapıp onaylayın. Tarayıcı yönlendirme adresinize gider, örneğin `https://localhost/?code=AQB...#_`. Sayfa
   açılmayabilir; sorun değil.
3. Adresin tamamını (veya yalnızca kodu) kopyalayıp MetaDash'e yapıştırın. Sondaki `#_` otomatik silinir. Kodlar
   **1 saat** geçerlidir ve **bir kez** kullanılabilir.

**B. Erişim token'ı**

Elinizde bir Threads kullanıcı erişim token'ı varsa (ör. Threads uygulamanız seçiliyken Graph API Explorer'dan veya
panelinizde görünüyorsa Threads kullanım senaryosu ayarlarındaki token oluşturucudan) onu yapıştırın.

Her iki durumda da MetaDash bunu **uzun ömürlü token**'a (60 gün) çevirir, profilinizi (`/me`) okur ve Threads
profilini takip edilen hesaplara ekler. Bağlantıyı kesmeden takibi daha sonra kapatabilirsiniz.

## 6. Token süresi ve otomatik yenileme

- Uzun ömürlü Threads token'ları **60 gün** geçerlidir.
- MetaDash açıkken, son yenilemeden bu yana **24 saatten fazla** geçmişse ve token'ın bitmesine **20 günden az**
  kalmışsa token otomatik yenilenir. Her yenileme 60 gün daha kazandırır.
- Threads yalnızca en az 24 saatlik ve **süresi dolmamış** token'ları yeniler. 60 gün içinde yenilenmeyen bir token
  (ör. MetaDash iki ay açılmadıysa) kalıcı olarak geçersiz olur: yeniden bağlanın (5. adım).
- Yenileme başarısız olursa uyarı görürsünüz; Ayarlar → Bağlantılar'daki **Yenile** düğmesini de kullanabilirsiniz.
- Threads token sorunu Instagram/Facebook senkronizasyonunu asla durdurmaz: Threads atlanır, çalışma "kısmi" olarak
  işaretlenir.
- **Bağlantıyı kes** token'ı siler ve profilin takibini bırakır; toplanmış veriler korunur.

## 7. MetaDash'in topladığı veriler ve sınırlar

| Veri | Kaynak | Not |
| --- | --- | --- |
| Profil | `/me` | kullanıcı adı, ad, fotoğraf, biyografi |
| Takipçi | `threads_insights` `followers_count` | her senkronizasyonda toplam; günlük değişim bu anlık görüntülerden hesaplanır |
| Gönderiler | `/{user}/threads` | metin, görsel, video, karusel ve ses gönderileri. Başkalarının gönderilerinin yeniden paylaşımları atlanır |
| Gönderi metrikleri | `/{post}/insights` | görüntülenme, beğeni, yanıt (yorum olarak gösterilir), yeniden paylaşım, alıntı, paylaşım |
| Günlük hesap metrikleri | `threads_insights` | görüntülenme (günlük seri); günlük beğeni, yanıt, yeniden paylaşım, alıntı ve link tıklaması |
| Demografi | `follower_demographics` | yaş, cinsiyet, ülke, şehir; haftalık; **yalnızca en az 100 takipçili profiller** |

Sınırlar:
- Hesap istatistikleri **13 Nisan 2024** öncesi için alınamaz (Meta verileri yalnızca 1 Haziran 2024'ten itibaren
  garanti eder). MetaDash daha eski tarih istemez.
- Threads'te erişim (reach) metriği yoktur; Threads için ana metrik **görüntülenme**'dir.
- Threads'in kendi istek sınırı vardır (profilinizin 24 saatlik gösterimlerine bağlı), Meta Graph API'den ayrıdır.
  MetaDash Threads'i tek tek senkronize eder ve gerektiğinde otomatik yavaşlar.
- Bu sürümde MetaDash kurulumu başına bir Threads profili desteklenir.

## 8. Sorun giderme

| Mesaj | Ne yapmalı |
| --- | --- |
| *Threads App ID yalnızca rakamlardan oluşmalı* | Muhtemelen Facebook App ID'yi veya uygulama adını kopyaladınız. **Threads App ID**'yi kullanın (2. adım). |
| *Threads yetkilendirme kodu geçersiz veya süresi dolmuş* | Kodlar 1 saat geçerlidir ve bir kez çalışır. Yeniden giriş yapıp yeni kodu yapıştırın. Yönlendirme adresinin panelde ve MetaDash'te aynı olduğunu kontrol edin. |
| *Threads token'ı geçersiz* | Token başka bir uygulamaya ait, iptal edilmiş veya hesap test kullanıcısı değil (3. adım). Yenisini oluşturun. |
| *Threads token'ı ancak en az 24 saatlik olduğunda yenilenebilir* | Bir gün bekleyin; otomatik yenileme halleder. |
| *Threads bağlantınızın süresi doldu* | Yeniden bağlanın (5. adım). |
| Demografi boş kalıyor | Profilin en az 100 takipçisi olmalı. |
| Tarayıcıda "Redirect URI mismatch" | Paneldeki ve MetaDash'teki adres, `https://` ve sondaki `/` dahil aynı olmalı. |
