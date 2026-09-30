# MetaDash TikTok Kurulum Rehberi (deneysel)

[English](../tiktok-setup.md)

MetaDash, kendi oluşturduğunuz bir TikTok geliştirici uygulamasıyla TikTok'un resmî **Login Kit** ve **Display API**
arayüzleri üzerinden **kendi** TikTok hesaplarınızı okuyabilir. Entegrasyon **Deneysel** olarak işaretlidir: TikTok
üçüncü taraf uygulamalara Meta ya da YouTube'a göre çok daha az veri verir ve sandbox test kullanıcıları dışındaki
hesapların bağlanabilmesi için Display API'nin uygulamanız için onaylanması gerekir.

2026-09-30 tarihinde developers.tiktok.com ile karşılaştırıldı. TikTok portalı sık değişir; menü adları farklı olabilir.

**İçindekiler**

1. [MetaDash neleri alabilir, neleri alamaz](#1-metadash-neleri-alabilir-neleri-alamaz)
2. [Geliştirici uygulamasını oluşturun](#2-geliştirici-uygulamasını-oluşturun)
3. [Yönlendirme adresini kaydedin](#3-yönlendirme-adresini-kaydedin)
4. [Sandbox mu, canlı mı](#4-sandbox-mu-canlı-mı)
5. [MetaDash'te bağlanın](#5-metadashte-bağlanın)
6. [Token'lar ve gizlilik](#6-tokenlar-ve-gizlilik)
7. [Sorun giderme](#7-sorun-giderme)

---

## 1. MetaDash neleri alabilir, neleri alamaz

| Alınabilen (Display API) | Kapsam |
|---|---|
| Profil: görünen ad, avatar, kullanıcı adı, biyografi, doğrulama rozeti | `user.info.basic`, `user.info.profile` |
| Takipçi, takip edilen, toplam beğeni, video sayısı | `user.info.stats` |
| Herkese açık videolar: açıklama, tarih, süre, kapak, bağlantı, **izlenme, beğeni, yorum, paylaşım** (kümülatif) | `video.list` |

Display API kullanan üçüncü taraf uygulamalara **verilmeyenler**: günlük analizler, erişim, izlenme süresi, trafik
kaynakları, kitle demografisi, yorumları okuma ya da yanıtlama. (Bunlar İşletme hesabı ve ayrı bir onay gerektiren
TikTok *API for Business* tarafındadır; MetaDash v2.0 bunu kullanmaz.)

Günlük seri olmadığı için MetaDash günlük izlenme ve yeni takipçiyi her eşitlemenin sakladığı verilerden **tahmin eder**:
- günlük yeni takipçi = bu eşitleme günündeki takipçi − önceki eşitleme günündeki takipçi;
- günlük izlenme = her videonun kümülatif izlenme sayısının eşitlemeler arasındaki artışı.

Hesap sayfası bunları "eşitlemelerden tahmini" olarak etiketler. Doğru günler için günde en az bir kez eşitleyin
(Ayarlar → Arka plan); eşitleme yapılmayan günün artışı bir sonraki eşitlenen güne yazılır.

Diğer sınırlar:
- Kapak görselleri yaklaşık 6 saat sonra geçersiz olan CDN bağlantılarıdır; MetaDash her eşitlemede yeniler.
- Yalnızca herkese açık videolar döner. Fotoğraf gönderileri belgelenmiş video listesinde yer almaz.
- Hız sınırı: uç nokta başına dakikada 600 istek. MetaDash her çağrıda 20 video ister ve gönderi sayılarını 20'lik
  gruplarla yeniler; büyük hesaplar bile birkaç çağrıyla biter.

## 2. Geliştirici uygulamasını oluşturun

1. [developers.tiktok.com](https://developers.tiktok.com/) adresinde oturum açın, **Manage apps** → **Connect an app**
   (ya da **Create app**) seçin. Bireysel ya da kurumsal geliştirici hesabı seçebilirsiniz.
2. Uygulama bilgilerini doldurun (inceleme için ad, simge, kategori, açıklama, kullanım koşulları ve gizlilik adresleri gerekir).
3. **Platforms**: **Desktop** seçin. (Yalnızca kod yapıştırma yedeğini kullanacaksanız **Web**'i de ekleyin, bkz. §3.)
4. **Add products**: **Login Kit** ve **Display API**.
5. **Scopes**: şu kapsamların ekli olduğundan emin olun: `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list`.
6. Uygulama sayfasından **Client key** ve **Client secret** değerlerini kopyalayın.

MetaDash'te: **Ayarlar → Bağlantılar → TikTok → TikTok geliştirici uygulaması**; client key ve secret'ı yapıştırın,
anahtar bir sandbox'a aitse *Bu bir sandbox uygulaması* seçeneğini işaretleyin (sandbox'ın kendi key ve secret'ı
vardır). Secret bu bilgisayarda şifrelenir ve TikTok'a yapılan token istekleri dışında hiçbir yere gönderilmez.

## 3. Yönlendirme adresini kaydedin

**Önerilen — Desktop loopback.** TikTok'un masaüstü Login Kit'i herhangi bir porta sahip loopback adreslerini kabul
eder. Login Kit → **Redirect URI** (Desktop) bölümüne tam olarak şunu kaydedin:

```
http://127.0.0.1:*/callback/
```

MetaDash rastgele bir portta tek seferlik yerel bir dinleyici açar, onayladıktan sonra tarayıcınız oraya döner ve
bağlantı kendiliğinden tamamlanır. Ağa hiçbir şey açılmaz (yalnızca 127.0.0.1; dinleyici bir istekten ya da 5
dakikadan sonra kapanır).

**Yedek — kod yapıştırma.** Loopback sizde çalışmazsa (ör. katı bir güvenlik duvarı ya da uzak masaüstü), **Web**
platformunu ekleyip https bir geri dönüş sayfası kaydedin ve MetaDash'te *Kod yapıştırarak giriş*i kullanın.
MetaDash bunun için `docs/oauth/callback.html` statik sayfasını içerir; varsayılan adres
`https://mbahadirs.github.io/metadash/oauth/callback.html` (kendi kopyanızı barındırıp adresini *Kod yapıştırma geri
dönüş sayfası* alanına girebilirsiniz). Sayfa yalnızca adresindeki `code` ve `state` değerlerini kopyalayabilmeniz
için gösterir; hiçbir yere veri gönderen betik içermez. Kod tek başına işe yaramaz: takas için client secret'ınız ve
bilgisayarınızdan hiç çıkmayan PKCE doğrulayıcısı gerekir, ayrıca dakikalar içinde geçersiz olur.

> Kod yapıştırma akışı daha az denenmiştir: TikTok PKCE'yi yalnızca masaüstü/mobil yönlendirmeler için belgeliyor.
> TikTok kodu *code verifier* hatasıyla reddederse loopback akışını kullanın.

## 4. Sandbox mu, canlı mı

- **Sandbox**: inceleme gerekmez. En fazla **10 hedef kullanıcı** ekleyin (Sandbox → **Target users**); yalnızca bu
  TikTok hesapları giriş yapabilir. MetaDash'i kendi hesaplarınızla denemek için uygundur.
- **Canlı (production)**: uygulamayı dört kapsamla incelemeye gönderin. TikTok verinin nasıl kullanıldığını inceler
  (genellikle MetaDash'in bağlantı kartını ve hesap sayfasını gösteren kısa bir ekran kaydı istenir). Onaydan sonra
  yönettiğiniz her hesap bağlanabilir.

## 5. MetaDash'te bağlanın

1. **Ayarlar → Bağlantılar → TikTok → Tarayıcıyla bağlan.** Eklemek istediğiniz TikTok hesabıyla giriş yapıp
   kapsamları onaylayın.
2. Tarayıcı *Giriş yapıldı* gösterir; MetaDash hesabı (`@kullanıcıadı`) ekler ve takibe alır. Bir eşitleme çalıştırın.
3. Her TikTok hesabı için tekrarlayın (her hesap kendi token'larıyla ayrı bir bağlantıdır).

Hesabı eşitlemelere dahil etmek ya da çıkarmak için **Takip et** anahtarını, MetaDash'in TikTok'taki erişimini
iptal etmek için **Bağlantıyı kes**'i kullanın. Bağlantıyı keserken MetaDash'in o hesap için sakladığı her şeyi de
silebilirsiniz.

## 6. Token'lar ve gizlilik

- Erişim token'ları **24 saat** geçerlidir; MetaDash eşitleme sırasında otomatik yeniler.
- Yenileme token'ı **365 gün** geçerlidir (TikTok değiştirebilir; MetaDash her zaman en yenisini saklar). Süresi
  dolmak üzereyken MetaDash uyarı gösterir; yenilemek için hesabı yeniden bağlayın.
- Token'lar MetaDash'in yerel veritabanında şifreli saklanır. Parola olmadan yedeklere dahil edilmez ve isteğe bağlı
  yayın worker'ına hiçbir zaman gönderilmez.
- Erişimi TikTok uygulamasının kendisinden de kaldırabilirsiniz (güvenlik ayarlarındaki uygulama izinleri listesi; menü adı
  sürüme göre değişir).

## 7. Sorun giderme

| Mesaj | Anlamı / çözüm |
|---|---|
| TikTok sayfasında *redirect_uri* hatası | Yönlendirme adresi birebir kayıtlı değil (Desktop için sondaki eğik çizgi dahil `http://127.0.0.1:*/callback/`). |
| *Oturum süresi doldu — yeniden bağlayın* | Yenileme token'ının süresi doldu ya da iptal edildi (ör. uygulamayı TikTok'tan kaldırdınız). Hesabı yeniden bağlayın. |
| Eşitleme kaydında *scope_not_authorized* | Hesap bir kapsamı onaylamadı ya da kapsam uygulamanıza ekli değil. Portalda ekleyip yeniden bağlanın. |
| *rate_limit_exceeded* | Dakikada 600'den fazla çağrı. MetaDash bekleyip yeniden dener; eşitleme sonraki çalıştırmada devam eder. |
| Yalnızca bazı hesaplar giriş yapabiliyor | Uygulamanız sandbox'ta: hesabı hedef kullanıcı olarak ekleyin ya da uygulamayı onaylatın. |
| Günlük izlenmeler dalgalı görünüyor | Eşitlemelerden tahmin edilir: eşitleme yapılmayan günlerin artışı bir sonraki eşitlenen güne yazılır. Her gün eşitleyin. |
