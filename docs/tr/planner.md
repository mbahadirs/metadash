# Planlayıcı

<!-- v1.4 C parçasına ait bölümler: "En iyi zaman önerileri", "Müşteri onayı", "Arka planda çalışma".
     Takvim, düzenleyici, doğrulama ve kuyruk arayüzü bölümlerini D parçası yazar. -->

## En iyi zaman önerileri

Düzenleyici ve haftalık görünüm, seçili hesap(lar) için yayın saati önerir:

- Öneriler, son 180 günde senkronize edilen gönderilerinizin etkileşim oranına dayanır ve haftanın günü ile saate göre gruplanır. Saatler, En iyi zaman ısı haritasında olduğu gibi bu bilgisayarın yerel saatidir.
- En az 3 gönderisi olan bir saat dilimi kendi ortalama etkileşim oranını kullanır. Daha az gönderisi olan saatler hesabın genel ortalamasına doğru çekilir (k = 3), böylece tek bir şanslı gönderi sonucu belirlemez.
- Seçili hesapların etkileşim verisi olan gönderi sayısı 10'dan azsa, aynı platformdaki tüm takip edilen hesaplar kullanılır (**portföy**). Bu da yetmezse tipik paylaşım saatlerinden oluşan genel bir tabloya (**varsayılan**) dönülür. Her öneri hangi kaynaktan geldiğini gösterir.
- 15 dakikadan yakın saatler önerilmez. Aynı hesaptaki başka bir planlı gönderiye *Gönderiler arası en az* süreden (Ayarlar → Yayınlama, varsayılan 3 saat) yakın saatler de önerilmez. Öneriler birbirinden de en az bu kadar uzak tutulur. Mevcut bir gönderiyle çakışan saat yalnızca başka seçenek kalmadığında, çakışan gönderiyle birlikte gösterilir.

## Müşteri onayı

### İş akışı

`Taslak → İncelemede → Onaylandı → Planlandı`. Müşteri bunun yerine değişiklik isteyebilir (`Değişiklik istendi`). **Planlamadan önce onay zorunlu olsun** açıksa (Ayarlar → Yayınlama), gönderi ancak onaylandıktan sonra planlanabilir. Onaylı bir gönderinin içeriği değişirse gönderi yeniden incelemeye döner. Yalnızca saatini değiştirmek onayı bozmaz.

### Onay paketleri

**Planlayıcı → Onaylar → Paketi dışa aktar**, müşteriniz için tek bir dosya kaydeder. Sunucu, hesap veya giriş gerekmez.

- **HTML:** kendi içinde eksiksiz tek bir dosyadır. Rapor markanızı (logo, ajans adı, vurgu rengi, alt bilgi) taşır. Her gönderide referansı (ör. `P-0042`), tarih ve saati, hedef hesaplar, görselli önizleme, metin, platforma özel metinler, ilk yorum ve içerik sürümü yer alır. İç notlar, *Notları ekle* işaretlenmedikçe dosyaya girmez. Müşteri dosyayı herhangi bir tarayıcıda açar. Her gönderi için **Onayla** veya **Değişiklik iste** seçip isterse yorum yazar, adını girer ve **Yanıtı kopyala**'ya basar. Ortaya `MDAP1.` ile başlayan bir kod çıkar; müşteri bunu e-posta veya mesajla size gönderir. Sayfa internete bağlanmaz.
- **PDF:** aynı içerik, yazdırmak veya telefonda okumak için. Formu yoktur; müşteri referansları belirterek e-postayla yanıt verir (ör. "P-0042: onaylandı").

Müşterinin kodunu **Planlayıcı → Onaylar → Yanıtı içe aktar**'a yapıştırın:

- **Uygulandı:** karar, müşterinin adıyla gönderinin kaydına işlenir. Taslaklar otomatik olarak *İncelemede* aşamasından geçirilir.
- **Eskimiş:** gönderi paket oluşturulduktan sonra düzenlenmiş, yani müşteri artık var olmayan bir içeriği onaylamış. Hiçbir şey değişmez; yeni bir paket gönderin.
- **Bilinmeyen:** gönderi silinmiş veya referans o pakette yok.
- **Uygulanmadı:** örneğin *Değişiklik iste* yanıtı alan planlı bir gönderi. Önce planı kaldırın. Yorum yine de kayda işlenir.

Kod, yarım kopyalanmış ya da yanlış pakete yapıştırılmış kodları yakalayan kısa bir sağlama değeri taşır. Anahtar paket dosyasının içinde olduğu için bu bir imza **değildir**. Yanıtı müşterinin e-postası gibi değerlendirin. E-posta veya WhatsApp ile gelen onaylar, onaylayanın adıyla **Onaylandı olarak işaretle** kullanılarak elle de kaydedilebilir.

## Arka planda çalışma

MetaDash'in kendisinin gönderdiği gönderiler (Instagram, Threads ve uygulama modundaki Facebook) yalnızca **uygulama çalışırken ve bilgisayar uyanıkken** yayınlanır. Bilgisayar kapalıyken yalnızca doğrudan Facebook'ta planlanan gönderiler ("Facebook'ta planla") yayınlanır. Ayarlar **Ayarlar → Arka planda çalışma** bölümündedir.

| Ayar | Ne yapar |
|---|---|
| Sistem tepsisinde / menü çubuğunda çalışmaya devam et | Pencereyi kapatmak uygulamadan çıkmaz. Pencere bellek boşaltmak için kapanır, uygulama sistem tepsisinde (Windows/Linux) veya menü çubuğunda kalır (macOS'ta açık pencere yokken Dock simgesi gizlenir). Pencereyi ilk kapattığınızda bunu açıklayan bir bildirim çıkar. |
| Oturum açıldığında başlat | macOS/Windows: oturum açma öğesi. Linux: `~/.config/autostart/metadash.desktop` (AppImage kullanıyorsanız ona işaret eder). Geliştirme sürümleri kaydetmez. |
| Oturum açılışında gizli başlat | Tepsi modu açıkken, oturum açılışında pencere açılmaz, yalnızca tepsi simgesi görünür. macOS 13 ve sonrası uygulamaya oturum açılışında açıldığını artık bildirmediği için, açılıştan sonraki ilk 5 dakikada yapılan başlatma da oturum açılışı sayılır. |
| Bilgisayarı uyanık tut… | MetaDash'in göndereceği her gönderiden 10 dk önce ile 5 dk sonrası arasında uygulamanın askıya alınmasını engeller. Kapağı kapatılan dizüstü bilgisayar yine de uyur. |

**Tepsi menüsü:** sıradaki gönderi (ör. "Sıradaki: Sal 14:00 · @marka (IG)"), bugün kalan gönderi sayısı, Yayınlamayı duraklat/sürdür, Şimdi güncelle, MetaDash'i aç, Planlayıcıyı aç ve Çık. Menü her dakika ve planlayıcıda her değişiklikte yenilenir. Windows/Linux'ta sol tık pencereyi açar. Bazı Linux masaüstlerinde (ör. AppIndicator eklentisi olmayan GNOME) tepsi simgeleri görünmez.

**Çıkış:** MetaDash'in göndereceği gönderilerden biri 2 saat içindeyse **Çık** önce sorar ("N gönderi MetaDash kapalıyken yayınlanmayacak"). Güncelleme kurulurken ve bilgisayar kapanırken sorulmaz.

**Tek kopya:** MetaDash'i yeniden açmak, ikinci bir kopya başlatmak yerine açık pencereyi öne getirir. İkinci bir kopya aynı gönderiyi iki kez yayınlayabilirdi.

**Uykudan sonra:** bilgisayar uyandığında veya ekran kilidi açıldığında MetaDash kuyruğu hemen kontrol eder. Bilgisayar uykudayken veya uygulama kapalıyken zamanı geçen gönderiler **Kaçırılan gönderiler** ayarına göre işlenir (Ayarlar → Arka planda çalışma):
- *Bana sor* (varsayılan): bir bildirim alırsınız; Kuyruk sekmesi Şimdi yayınla, Yeniden planla veya Atla seçeneklerini sunar.
- *Geç de olsa yayınla*: en fazla *En fazla gecikme* dakika geciken gönderiler yayınlanır.
- *Atla*: gönderiler kaçırıldı olarak işaretlenir.

<!-- Planlayıcı arayüz bölümleri: v1.4 chunk D. Tepsi / arka plan ve onay paketi bölümleri ayrıca yazılır (chunk C). -->

## Planlayıcıyı açmak

Kenar çubuğundaki **Planlayıcı** (takvim simgesi) içerik takvimini açar. Araç çubuğunda hesap filtresi, genel platform filtresi (Tümü / Instagram / Facebook / Threads; birden fazla platform izleniyorsa görünür) ve **Yeni gönderi** düğmesi bulunur. Ekranda beş sekme vardır:

| Sekme | İçerik |
| --- | --- |
| **Takvim** | Zamanlanmış gönderilerin ay ya da hafta görünümü ve zamanı olmayan taslaklar için **Zamanlanmamış** listesi |
| **Liste** | Tüm gönderiler; durum filtreleri, arama (başlık, metin ya da `P-0042` numarası) ve toplu durum değişikliği |
| **Yayın kuyruğu** | Her hesabın yayın durumu, sonraki deneme, son hata, yeniden dene/iptal, günlük kota göstergeleri, duraklatma anahtarı ve kaçırılan gönderiler bandı |
| **Onaylar** | İncelemedeki, değişiklik istenen ya da onaylanmış gönderiler; elle onay, onay paketi oluşturma ve müşteri yanıtını içe aktarma |
| **Kayıt** | Her değişikliğin kaydı (kim, ne, ne zaman), en yenisi üstte |

Doğrudan bağlantılar da çalışır; örneğin `#/planner?tab=queue&missed=1` (bildirimler ve tepsi kullanır) ya da `#/planner?post=12` (12 numaralı gönderiyi açar).

## Takvim

- **Ay** altı haftayı gösterir; her günde en fazla üç gönderi ve o haftayı açan "+n daha" bağlantısı vardır. **Hafta** 7 × 24 saatlik bir ızgaradır ve 08:00'e kaydırılmış açılır.
- Gönderi kartında saat, platform işaretleri, duruma göre renkli bir çizgi, doğrulama hatası varsa kırmızı bir nokta ve gönderi Facebook'ta zamanlandıysa ✓ görünür ("Facebook'ta zamanlandı" bilgisayarınız kapalıyken de yayınlanır).
- **Sürükle bırak:** gönderiyi başka bir güne (ay görünümünde saat korunur) ya da saate (hafta görünümünde bıraktığınız yere göre 15 dakikaya yuvarlanır) sürükleyin. Bırakırken **Alt/Option** basılıysa gönderi taşınmaz, kopyalanır. Geçmişe bırakmak reddedilir. Takvimdeki bir gönderiyi **Zamanlanmamış** alanına bırakmak zamanını kaldırır (zamanlanmış gönderilerde önce zamanlamayı kaldırın). Takvim hemen güncellenir, değişiklik başarısız olursa geri alınır.
- **Klavye:** Tab ile bir gönderiye gelin; **Enter** açar, **R** yeniden zamanlama penceresini açar (tarih/saat, "taşımak yerine kopyala", zamanı kaldır), **Alt+←/→** bir gün, **Alt+↑/↓** 15 dakika taşır (**Shift** ile kopyalar).
- **En iyi zamanlar:** tek bir hesap seçiliyken hafta görünümü önerilen saatleri renklendirir (paylaşım geçmişinize göre).
- Gün ya da saat hücresindeki **+** o zamana yeni gönderi başlatır.

## Gönderi düzenleyici

Bir gönderiye (ya da **Yeni gönderi**'ye) tıklamak sağda düzenleyiciyi açar (dar pencerelerde tam genişlik).

- **Hesaplar:** Instagram, Facebook Sayfası ve Threads hesaplarını istediğiniz gibi karıştırın. Her hesabın bir biçimi olur (Otomatik, medyaya göre seçer: tek görsel → görsel/fotoğraf, birden fazla → carousel/albüm, video → reels ya da video; değiştirebilirsiniz). Sayfalar için **Facebook'ta zamanla** anahtarı (Facebook gönderiyi kendisi yayınlar, bilgisayarınız kapalıyken de çalışır) ve Facebook bağlantı gönderileri için adres alanı vardır. Yayın izni olmayan hesaplar işaretlenir.
- **Medya:** **Dosya ekle** ile seçin, Finder/Gezgin'den sürükleyin ya da bir görsel yapıştırın. Dosyalar MetaDash medya kitaplığına (`<veri klasörü>/planner-media`) kopyalanır; aynı dosya bir kez saklanır. Sürükleyerek ya da ← / → düğmeleriyle sıralayın, alternatif metin ekleyin, küçük resme tıklayarak boyut, çözünürlük, süre ve kodek bilgisiyle önizleyin. Sorunlu medyanın çerçevesi renklidir.
- **Açıklama:** ortak bir açıklama ve ilk yorum, ayrıca her hesap için ayrı açıklama ya da ilk yorum sekmesi. Anlık sayaçlar karakterleri (emoji tek sayılır), hashtag'leri ve bahsetmeleri her platformun sınırıyla gösterir (Instagram 2.200 karakter / 30 hashtag / 20 bahsetme, Facebook 63.206, Threads 500 karakter / 1 konu etiketi / 5 bağlantı).
- **Zamanlama:** bilgisayarınızın saat diliminde tarih ve saat, seçili hesaplar için en iyi zaman önerileri. Kaydedilmiş bir gönderinin zamanını değiştirmek hemen uygulanır.
- **Kontroller:** gönderi siz yazarken doğrulanır (biçimler, medya sayısı ve boyutu, en-boy oranı, video süresi/kodeği, geçmiş zaman, eksik medya sunucusu ya da izin, kota, birbirine çok yakın gönderiler). Hatalar zamanlamayı engeller; uyarılar ve notlar engellemez.
- **Önizleme:** her hesap için yaklaşık bir Instagram / Facebook / Threads görünümü.
- **Kaydetme:** yeni gönderi **Taslağı kaydet** (Cmd/Ctrl+S) ya da ilk iş akışı adımıyla oluşturulur; sonrasında değişiklikler otomatik kaydedilir. Gönderi bu arada başka bir yerde değiştiyse bir uyarı bandı son hâli yüklemenizi ya da üzerine yazmanızı sağlar. Kaydedilmemiş yeni bir gönderiyi kapatırken onay istenir.
- **Sonuçlar ve geçmiş:** kaydedilmiş gönderilerde ikinci sekme her hesabın yayın durumunu, canlı gönderi bağlantısını, yayın zamanını, deneme sayısını, sonraki denemeyi ve Meta hata kodu ile `fbtrace_id` içeren son hatayı (destek için yararlı) hesap başına **Yeniden dene** ve **İptal** ile gösterir; altında gönderinin geçmişi yer alır.

## İş akışı

Gönderi **Taslak → İncelemede → Onaylandı → Zamanlandı → Yayınlandı** yolunu izler. Düzenleyicinin alt çubuğu geçerli adımları gösterir:

| Durum | İşlemler |
| --- | --- |
| Taslak | İncelemeye gönder, Zamanla (onay zorunlu değilse), Arşivle, Sil |
| İncelemede | Onayla (isteğe bağlı onaylayan adı), Değişiklik iste (notla), Taslağa geri al |
| Değişiklik istendi | İncelemeye gönder, Taslağa geri al |
| Onaylandı | Zamanla, Taslağa geri al |
| Zamanlandı | Zamanlamayı kaldır, Şimdi yayınla |
| Başarısız / Kısmen yayınlandı | Yeniden dene |
| Arşivlendi | Geri yükle |

Her gönderi kopyalanabilir. **Planlamadan önce onay zorunlu olsun** açıkken (Ayarlar → Yayın) taslak doğrudan zamanlanamaz; onaylanmış ya da zamanlanmış bir gönderinin içeriğini değiştirmek onu incelemeye geri gönderir. Gönderiyi yalnızca zamanda taşımak onayı bozmaz.

## Liste, kuyruk ve kayıt

- **Liste:** satırları seçin (onay kutuları ya da Boşluk) ve toplu işlem çubuğuyla incelemeye gönderin, onaylayın, taslağa alın ya da arşivleyin. Adıma uygun olmayan gönderiler atlanır ve nedeni gösterilir.
- **Yayın kuyruğu:** yayıncının sıradaki işlerini gösterir. **Yayın açık/kapalı** tüm yayınları duraklatır. MetaDash kapalıyken zamanı gelen gönderiler bir bantta **Şimdi yayınla**, **Yeniden zamanla** (seçtiğiniz zamana) ve **Atla** seçenekleriyle listelenir.
- **Kayıt:** tüm değişiklik geçmişi; **Daha fazla yükle** daha eskilerini getirir.

Planlayıcı her iki temada ve Türkçe/İngilizce çalışır.
