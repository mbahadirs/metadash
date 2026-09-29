# Yapay zekâ stüdyosu

<!-- v1.5 B parçasına ait bölüm. -->
## Marka sesi ve açıklamalar

### Marka sesi (Stüdyo → Marka sesi)

Takip edilen her hesabın bir **marka sesi özeti** olabilir. Bu kısa ve düzenlenebilir metin, o hesap için üretilen her açıklamada modele gönderilir; yorum yanıtları da onu kullanır. Özetin yanında ton, resmiyet, hitap (`sen` / `siz`), açılış kalıpları, harekete geçirici ifadeler, yap/yapma kuralları ve görsel stil de belirlenebilir.

- **Açıklama istatistikleri (yapay zekâ gerekmez).** Sağdaki panel, hesabın son 12 aydaki açıklamalarından bilgisayarınızda hesaplanır. Ortalama ve medyan uzunluğu, gönderi başına emoji sayısını ve en sık emojileri, gönderi başına hashtag sayısını ve yerini (sonda, metin içinde, karışık), soru ve satır arası kullanım oranını, sık CTA kelimelerini, dil dağılımını (basit bir Türkçe/İngilizce sezgisi) ve açıklamaların `sen` mi `siz` mi dediğini gösterir. Aynı veriyle her seferinde aynı sonucu verir.
- **Gönderilerimden türet.** MetaDash, hesabın son 12 aydaki en iyi gönderilerini (20, 50 veya 100; erişim, Threads'te görüntülenme, ve etkileşim oranına göre) ve karşılaştırma için 10 zayıf gönderiyi seçer. Ardından istatistikleri ve bu açıklamalardan en fazla 30 tanesini (22 iyi + 8 zayıf, her biri 600 karakterle kısaltılmış) yapay zekâ sağlayıcınıza gönderir. Gelen yanıt yalnızca bir **öneridir**: fark görünümü mevcut özetten neyin değiştiğini gösterir ve siz **Kaydet**'e basana kadar hiçbir şey kaydedilmez. Kaydedilen ses "yapay zekâ ile türetildi", değiştirdiyseniz "yapay zekâ ile türetildi, düzenlendi" olarak işaretlenir. **Yeniden türet** de aynı şekilde çalışır.
- **Görseller (isteğe bağlı).** "En iyi gönderilerin görsellerini de gönder" seçiliyse modelin görsel stil notu ekleyebilmesi için en fazla 6 küçük görsel gönderilir. Bu seçenek varsayılan olarak kapalıdır; modeliniz görsel göremiyorsa veya Ayarlar → Yapay zekâ bölümünde görsel gönderimini kapattıysanız görünmez.
- **Bu hesap için yapay zekâyı kapat.** Açıkken bu hesabın hiçbir verisi (açıklamalar, görseller, özet, yorumlar) yapay zekâ sağlayıcısına gönderilmez. Tüm Stüdyo özellikleri istek göndermeden önce reddeder. Özeti yine de elle düzenleyebilirsiniz.

Özellik yapay zekâ olmadan da çalışır: istatistikler ve kendi yazdığınız bir özet.

### Açıklama önerileri (Planlayıcı editörü → Yapay zekâ yardımı)

Açıklama alanının altındaki **Yapay zekâ yardımı** paneli yalnızca yapay zekâ açıkken görünür. Hesapları seçin, birkaç not yazın (konu, ürün, teklif, görselde ne var), dilleri (Türkçe, İngilizce veya ikisi) ve dil başına öneri sayısını seçin, ardından **Öneri üret**'e basın.

- **Sınırlar.** Uzunluğu seçili en katı platform belirler: Instagram için 2.200 karakter ve en fazla 30 hashtag, Threads için 500 karakter ve 1 konu etiketi. Threads, Instagram veya Facebook ile birlikte seçildiyse her öneriye ayrıca ≤ 500 karakterlik bir **Threads sürümü** eklenir. Her öneri editördeki doğrulamanın aynısıyla kontrol edilir; platform başına karakter sayısı ve varsa sorunlar gösterilir. Bir öneri yine de uzunsa MetaDash tek bir otomatik "N karaktere kısalt" isteği yapar.
- **Öneriler.** Her öneri farklı bir açıdan yazılır (soru ile açılış, hikâye, fayda, …) ve kendi dilinde doğal olarak yazılır. **Kullan** öneriyi ortak açıklamaya kopyalar. **Threads metnini kullan** Threads sürümünü Threads hesaplarının kendi açıklamasına koyar. Gönderi kaydedilmişse öneriler gönderiyle birlikte saklanır.
- **Görseller.** Modeliniz görsel görebiliyorsa gönderinin görselleri küçültülerek gönderilir (en fazla 4, uzun kenar ≤ 1.568 px; videolardan yalnızca kapak karesi). Göremiyorsa panel "Modeliniz görselleri göremiyor; görseli notlarda tarif edin" der ve yalnızca alt metinler ve dosya adları gönderilir. Görsel desteği bilinmeyen bir model görselleri reddederse istek yalnızca metinle tekrarlanır ve panel bunu belirtir.

**Gönderilenler** (düğmenin yanındaki "Ne gönderilecek?" bölümünde görünür): marka sesi özeti ve temel profil bilgileri, notlarınız, görsellerin alt metinleri (görsel desteği yoksa dosya adları da), görsel desteği açıksa görseller, stil örneği olarak hesabın en iyi 5 açıklaması ve denenmiş hashtag'leri ile artış değerleri. Eski açıklamalardaki @kullanıcı adları `@mention` ile değiştirilir. Hesap kimlikleri, kullanıcı adları, müşteri adları ve token'lar asla gönderilmez. Açıklamalar, notlar ve özet veri olarak alıntılanır: istem, modele bunların içindeki talimatlara asla uymamasını söyler ve etiket benzeri metinler bloklarının dışına çıkamaz.

### Hashtag önerileri (editör → Yapay zekâ yardımı → Hashtag önerileri)

Öneriler **hesabın son 12 aydaki kendi gönderilerinden** gelir ve yapay zekâ gerektirmez:

- **Artış (lift).** Her gönderinin erişimi (Threads'te görüntülenme), hesabın aynı gönderi türündeki medyan değerine bölünür. Bir etiketin artışı, onu kullanan gönderilerin ortalamasıdır; gönderi azsa 1'e doğru çekilir: `(artışların toplamı + 3) / (gönderi + 3)`. En az 2 gönderide kullanılmış etiketler artış × ilgililik ile sıralanır. İlgililik, açıklama ve notlarla kelime örtüşmesidir; Türkçe karakterler sadeleştirildiği için "tatlı", `#tatli` ile eşleşir. Açıklamada zaten bulunan etiketler atlanır.
- **Aşırı kullanılan.** Gönderilerin %60'ından fazlasında geçen ve artışı 1 veya altında olan etiketler.
- **Unutulmuş iyi etiketler.** 90 gündür kullanılmayan ve artışı 1,2'nin üstünde olan etiketler.
- **Platform sınırları.** Instagram için varsayılan öneri 5'tir (API 30'a izin verir), Facebook için 3, Threads için 1 konu etiketi.

**Yapay zekâ ile sırala** seçiliyse açıklama, notlar ve denenmiş etiket tablosu modele gönderilir. Model yalnızca bu listeden seçip sıralayabilir ve en fazla 3 yeni etiket ekleyebilir; bunlar ayrıca **denenmemiş** olarak gösterilir. **Seçilenleri ekle** seçilen etiketleri açıklamanın sonuna ekler.

### Maliyet

Her sonuç "≈ N girdi / M çıktı token · ≈ $x (tahmini)" satırını gösterir; Ollama için "yerel" yazar. "Ne gönderilecek?" paneli düğmeye basmadan önce bir tahmin gösterir. Her çağrı özelliğe göre (ses, açıklama, hashtag) Stüdyo → Kullanım bölümünde kaydedilir. Yalnızca sayılar saklanır, açıklamalarınız saklanmaz.

<!-- v1.5 D parçasına ait bölüm. -->
## Yorum yanıtları ve deneyler

### Gelen kutusu (Stüdyo → Gelen kutusu)

Gelen kutusu, Instagram gönderilerinize son 14 günde başkalarının yazdığı ve hesabın henüz yanıtlamadığı yorumları hesap hesap listeler. Bir yorum, hesap sahibinden bir yanıt aldığında (sağlık skorundaki yanıt oranıyla aynı kural) ya da gelen kutusunda "Tamamlandı" olarak işaretlendiğinde yanıtlanmış sayılır.

- **Yorumları yenile**, her hesabın son 14 gündeki gönderilerinin yorumlarını yeniden çeker (hesap başına en fazla 25 gönderi). Normal Meta istek sınırlayıcısını kullanır. Yorum senkronu açıksa yorumlar normal senkronla da gelir.
- **Yanıt öner**, tek bir yorumu yapay zekâ sağlayıcınıza gönderir ve 3 kısa yanıt ile bir kategori döndürür (soru, övgü, şikâyet, spam veya diğer). Şikâyet önerileri "DM'den devam edelim" seçeneğini de içerir. Hesabın marka sesi özeti (Stüdyo → Marka sesi) varsa yanıtlar ona uyar.
- **Yanıtı gönder…** her zaman bir onay penceresi açar. Pencere, gönderilecek metnin tamamını ve hangi hesaptan kime gideceğini gösterir. Bu onay olmadan hiçbir şey gönderilmez; otomatik veya toplu gönderim yoktur.
- **Tamamlandı**, yorumu yanıtlamadan yanıt bekleyenler listesinden çıkarır.

Gönderilen yanıt, yanıt süresiyle birlikte yerelde hesap sahibinin yanıtı olarak kaydedilir. Böylece hesabın yanıt oranı ve yanıt süresi metrikleri bir sonraki senkronu beklemeden hemen güncellenir.

**İzinler.** Yanıt `POST /{ig-comment-id}/replies` ile gönderilir. Bunun için `instagram_manage_comments` gerekir; ayrıca normal kurulumun zaten verdiği `instagram_basic`, `pages_show_list` ve `pages_read_engagement` izinleri de gerekir. Sayfa rolü Business Manager üzerinden geliyorsa `ads_management` veya `ads_read` de gerekir. İzin eksikse MetaDash bunu istek göndermeden önce söyler. İzni Meta uygulamanıza ekleyip Ayarlar → Bağlantı'dan yeniden bağlanın. Yalnızca ana yorumlar yanıtlanabilir. Instagram gizlenmiş yorumlara ve canlı yayın yorumlarına yanıt verilmesine izin vermez. Facebook ve Threads yorumları senkronlanmadığı için gelen kutusundan yanıtlanamaz. Facebook uç noktası (`POST /{comment-id}/comments`, Sayfa token'ı ve `pages_manage_engagement` ile) ileride kullanılmak üzere kodda belgelenmiştir.

**Demo modu:** gönderim simüle edilir. Instagram'a hiçbir şey gitmez, ancak gelen kutusu ve metrikler yanıt gönderilmiş gibi davranır.

**Yapay zekâ sağlayıcısına gönderilenler** (düğmenin yanındaki "Neler gönderilecek?" bölümünde görünür):

- yorum metni; yorumcunun kullanıcı adı ve metindeki @etiketler `@user1`, `@user2`, … ile değiştirilir (Ayarlar → Yapay zekâ → yorumcuları anonimleştir, varsayılan olarak açık);
- gönderi açıklaması (ilk 600 karakter);
- varsa marka sesi özeti.

Hesap kimlikleri, token'lar ve hesap adları asla gönderilmez. Gerçek kullanıcı adları önerilere bilgisayarınızda geri yerleştirilir. Yorumlar güvenilmeyen veri olarak ele alınır: istem, modele yorumların içindeki talimatlara asla uymamasını söyler ve yorumdaki etiket benzeri metinler alıntı bloğunun dışına çıkamaz. Yapay zekâsı kapatılmış hesaplar (Stüdyo → Marka sesi) gelen kutusunda yine görünür. Bu hesaplara elle yanıt yazabilirsiniz, ancak verileri yapay zekâ sağlayıcısına asla gönderilmez.

### Deneyler (Stüdyo → Deneyler)

Instagram, gönderi açıklamaları için gerçek bir bölünmüş test (split test) sunmaz. Bu yüzden MetaDash'teki bir deney, **gönderiler arası varyant etiketlemedir**. Her açıklama varyantını ayrı bir gönderi olarak yayınlar ve bir kola (A, B ve isteğe bağlı olarak C ve D) etiketlersiniz. MetaDash ardından her kolun gönderilerini hesabın olağan sonuçlarıyla karşılaştırır.

- **Oluşturma:** bir değişken (açılış cümlesi, uzunluk, emoji, harekete geçirici çağrı, hashtag, diğer) ve bir ölçüt (erişim artışı, etkileşim oranı, kaydetme oranı, görüntülenme artışı) seçin. Ardından her kola yayınlanmış veya planlanmış gönderiler ekleyin. Planlanan bir gönderi, yayınlanıp senkronlandığında sonuçlara katılır.
- **Artış:** her gönderi, hesabın paylaşımdan önceki 90 gündeki aynı türden gönderilerinin ortalamasıyla karşılaştırılır. 1,00× ortalamayla aynı, 1,30× ise %30 daha iyi demektir. Threads'te erişim metriği olmadığı için erişim artışı yerine görüntülenme kullanılır.
- **Hariç tutulan gönderiler:** 72 saatten yeni olan, henüz senkronlanmamış olan ve öncesinde karşılaştırılabilir en az 3 gönderisi bulunmayan gönderiler hariç tutulur. Her birinin yanında hariç tutulma nedeni yazar.
- **Kol başına:** tablo gönderi sayısını (n), ortalama ve medyan artışı ve ortalamanın %90 güven aralığını gösterir. Aralık sabit tohumlu bir bootstrap ile hesaplandığı için her açılışta aynı kalır.
- **Anlamlılık ipucu:**
  - **Daha fazla gönderi gerekli**, herhangi bir kolda kullanılabilir gönderi sayısı 3'ün altındayken gösterilir.
  - **Yön gösteriyor: Kol X**, en iyi kolun %90 aralığı diğer kolların hiçbiriyle örtüşmediğinde gösterilir. Ayrıntı görünümünde yaklaşık "Kol X'in en iyi olma olasılığı" da yer alır.
  - **Belirsiz**, diğer tüm durumlarda gösterilir.

  Yön gösteren bir sonuç bile kanıt değildir: gönderiler arasında konu, gün ve saat de farklıdır.
- **Sonuçlandırma:** ne öğrendiğinizi yazın. İsterseniz **Yapay zekâ ile özetle** kısa bir özet taslağı hazırlar. Bu özet için yalnızca sayılar ve kol başına en fazla 5 kısa açıklama (her biri 200 karakter) gönderilir; hesap adları veya kimlikleri asla gönderilmez.

<!-- Section owned by v1.5 chunk C. -->
## Fikirler ve dönüştürme

### Aylık içerik fikirleri (Stüdyo → Fikirler)
Bir hesap, bir ay (bu aydan başlayarak en fazla 12 ay sonrası), fikir sayısı (1–31, varsayılan 12), bir dil ve isteğe bağlı içerik eksenleri seçin, sonra **Fikir üret**'e basın. Her fikirde bir çalışma başlığı, format (reels, karusel, görsel, hikâye; Facebook/Threads için metin), içerik ekseni, kanca, açıklama taslağı, önerilen tarih, tek cümlelik gerekçe ve dayandığı en iyi gönderiler bulunur.

Modelin gördükleri (düğmeye basmadan önce sayıları ve token/maliyet tahminini görmek için **Ne gönderilecek?** bölümünü açın):
- kayıtlıysa hesabın marka sesi özeti (Stüdyo → Marka sesi);
- son 12 ayın en iyi 10 gönderisinin açıklamaları ve metrikleri; bunlara p1…p10 olarak atıf yapılır. @etiketler "@mention" ile değiştirilir;
- son 180 günün format bazında performansı (gönderi sayısı, ortalama erişim/görüntülenme, etkileşim oranı, kaydetme oranı);
- Planlayıcı'nın en iyi saat motorundan en iyi paylaşım saatleri (yalnızca gün ve saat);
- **Özel günleri dahil et** açıksa o aydaki özel günler;
- içerik eksenleriniz.

Hesap kimlikleri, kullanıcı adları ve müşteri adları hiçbir zaman gönderilmez. Açıklamalar alıntılanmış veri olarak gönderilir ve modelden içlerindeki talimatları yok sayması istenir. Çağrı, Stüdyo → Kullanım'a yalnızca sayılarla kaydedilir.

Fikirleri yerinde düzenleyin, istediklerinizi seçin ve **N taslak oluştur**'a basın. Her fikir, o hesap için bir Planlayıcı taslağı olur (kaynak "AI fikri"). Taslakta açıklama taslağı yer alır; kanca, gerekçe ve eksen notlara, eksen ayrıca etikete yazılır. Format, platformun en yakın formatına çevrilir (örneğin karusel → Facebook albüm, reels → Threads video).
- **En iyi saatlere yerleştir:** her taslak, önerilen gününde takvimle aynı önerilere göre en iyi saate konur. Taslaklar sırayla yerleştirildiği için Planlayıcı'nın aynı hesabın gönderileri arasındaki asgari süresi korunur. Tarihi olmayan fikirler ayın kalanına eşit aralıklarla dağıtılır; geçmiş günler bugüne taşınır.
- **Zamansız taslak:** taslaklar takvimin zamanlanmamış panelinde görünür.

Taslaklar hiçbir zaman otomatik olarak yayına zamanlanmaz. Medyayı ekleyip gözden geçirin ve Planlayıcı'da her zamanki gibi zamanlayın.

### Özel günler
Hazır liste, Türkiye'nin ulusal gün ve anma günlerini, yaygın küresel pazarlama ve farkındalık günlerini kapsar. Anneler Günü (Mayıs'ın 2. pazarı, TR/ABD), Babalar Günü (Haziran'ın 3. pazarı), Paskalya, Black Friday ve Cyber Monday gibi hesaplanan tarihler de listededir. Ramazan başlangıcı, Ramazan Bayramı ve Kurban Bayramı 2026–2028 için küçük bir tablodan gelir. Bunlar **yaklaşık** olarak işaretlidir ve bir gün kayabilir; Diyanet takvimiyle doğrulayın. Anma günleri (18 Mart, 15 Temmuz, 10 Kasım) **anma** olarak işaretlidir ve modelden bu günlerde saygılı, tanıtım içermeyen içerik istenir. Liste yaklaşıktır; resmî takvim değildir.

Kendi günlerinizi (kuruluş yıl dönümü, lansman, kampanya) **Kendi günlerim** ile ekleyin: her yıl tekrarlanan gün için `AA-GG`, tek seferlik gün için `YYYY-AA-GG` kullanın. Günler `studio.specialDays` ayarında saklanır.

### Gönderiyi dönüştürme
**Dönüştür** düğmesi, senkronize gönderilerde gönderi ayrıntı panelinde, planlayıcı gönderilerinde ise oluşturucunun işlem çubuğunda bulunur. Gönderiyi şunlara dönüştürür:
- **Karusel metni (Instagram):** 3–10 slayt başlığı ve metni ile bir açıklama. Slayt metinleri taslağın notlarına yazılır; görselleri siz tasarlarsınız.
- **Threads gönderisi:** genellikle tek gönderi, en fazla 500 karakter. Model sınırı aşarsa otomatik olarak bir "kısalt" çağrısı yapılır; hâlâ uzun olan metin kelime sınırından kesilir. Model bir zincir yazarsa taslağın açıklaması yalnızca ilk gönderidir; kalanlar yayından sonra yanıt olarak paylaşmanız için notlara eklenir.
- **Facebook gönderisi:** açıklamanın sayfa gönderisi sürümü.
- **Hikâye kareleri:** 2–7 kısa ekran metni; notlara kaydedilir.

Model videoyu izleyemediği için reels'ler için bir döküm yapıştırabilirsiniz. Yalnızca kaynak açıklama, temel metrikler, döküm ve marka sesi özeti gönderilir. Sonuç düzenlenebilir. **Planlayıcı'da taslak oluştur**, sonucu seçtiğiniz hesaplar için taslak olarak kaydeder (kaynak "dönüştürme"); yalnızca platformu o formatı yayınlayabilen hesaplar listelenir. Taslak, kökenini saklar (planlayıcı gönderileri için `parent_post_id`, her ikisi için `ai_meta.repurposedFrom`) ve oluşturucuda açılır.
