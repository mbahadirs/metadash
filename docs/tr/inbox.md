# Birleşik gelen kutusu

Gelen kutusu, bağlı tüm platformların yorumlarını tek listede toplar: Instagram, Facebook Sayfaları, Threads ve sağlayıcısı gelen kutusu adaptörü sunduğunda YouTube. Kenar çubuğunda **Gelen kutusu** olarak yer alır. Stüdyo → Gelen kutusu sekmesi ve her hesabın **Gelen kutusu** sekmesi aynı görünümü gösterir.

Doğrudan mesajlar kapsam dışıdır. Instagram ve Facebook mesajlaşması ek izinler, App Review ve webhook gerektirdiği için sonraki bir sürümün adayıdır.

## Neler yapabilirsiniz

- **Filtreleme.** Yanıtsız, Geciken, Yanıtlandı, Tamamlandı veya Tümü seçilebilir. Platform, hesap, duygu ve atanan kişiye göre daraltabilir, yalnızca soruları gösterebilir veya arama yapabilirsiniz. Liste sanallaştırılmıştır; büyük gelen kutuları da hızlı kalır.
- **Yanıt verme.** Yanıtı kendiniz yazabilir veya marka sesinizle yapay zekâ önerisi isteyebilirsiniz. MetaDash hiçbir yanıtı kendiliğinden göndermez: her yanıt açık onay ister. Yanıt üçüncü bir kişiden bahsediyorsa onay penceresi ayrıca uyarır.
  - Karakter sayacı platformun sınırını kullanır: Instagram 2.200*, Facebook 8.000*, Threads 500.
  - (*) Bu sınırlar Meta tarafından belgelenmemiştir.
- **İş akışı.** Bir yorumu tamamlandı olarak işaretleyebilirsiniz (yanıtsız kutudan çıkar). Yorumu yok sayabilir, yeniden açabilir veya bir ekip arkadaşınıza atayabilirsiniz. Ekipte durum ve atama değişiklikleri paylaşılan klasör üzerinden eşitlenir.
- **Gizleme.** Platform izin veriyorsa bir yorumu platformda gizleyebilir veya yeniden gösterebilirsiniz.
- **Klavye.** `j` / `k` listede gezinir, `e` yorumu tamamlandı yapar, `r` yanıt kutusuna geçer.
- **Yanıt süresi.** Yanıt süresi sekmesi ilk yanıt göstergelerini ve hesap bazında bir tablo gösterir.
- **Raporlar.** Müşteri raporlarında (aylık, haftalık müşteri, özel) HTML ve Excel için "Topluluk yanıtı" bölümü bulunur.
- **Bildirimler.** Hedef süreyi aşan yorumlar olduğunda ve yeni yanıtsız yorumlar geldiğinde (en fazla 6 saatte bir) bildirim alırsınız.

## Yorumlar nasıl gelir

- **Tam veya organik senkronizasyon.** Yorum senkronizasyonu açıksa her senkronizasyon, yorumları platformun gelen kutusu adaptörüyle çeker.
- **Arka planda yoklama.** MetaDash (veya tepsisi) açıkken yeni yorumlar 30 dakikada bir kontrol edilir. Bu yoklama `inbox` senkronizasyon kapsamı olarak çalışır; başka bir senkronizasyon sürüyorsa atlanır.
- **Yenile düğmesi.** "Yorumları yenile" hemen çeker. Komut satırında `metadash inbox pull` aynı işi yapar.

Hangi gönderiler yoklanır:

- son 14 günün tüm gönderileri;
- son yoklamadan beri senkronize edilen yorum sayısı artan daha eski gönderiler (en fazla 90 gün).

Hikâyeler atlanır. Yoklama durumu gönderi bazında `inbox_cursor` içinde tutulur.

## Ölçümler

- **İlk yanıt süresi (FRT):** bir yorumdan hesabın o yoruma verdiği ilk yanıta kadar geçen süre.
  - Yalnızca başkalarının üst düzey yorumları sayılır.
  - Yanıtsız olarak tamamlandı veya yok sayıldı işaretlenen yorumlar dışarıda bırakılır.
- **Yanıtlanan %:** hesabın yanıt verdiği yorumların gelen yorumlara oranı.
- **Hedef içinde %:** hedef süre (24 saat) içinde yanıtlanan yorumların uygun yorumlara oranı.
  - Bir yorum yanıtlandığında veya hedef süreden eski olduğunda uygun sayılır.
  - Yeni gelen bir yorum henüz aleyhinize sayılmaz.
- **Medyan / p90** FRT ve **birikim** (hedef süreyi aşmış yanıtsız yorumlar).
- **Sağlık puanı:** *yanıt* bileşeni %50 yanıtlanma oranı + %50 hedef içinde yanıt oranıdır. Gelen kutusu olmayan platformlar (TikTok) yeniden ağırlıklandırılmış puanı korur.

## Yapay zekâ ile duygu analizi (isteğe bağlı)

Çevrimdışı bir kural soruları her zaman işaretler. Soru işaretine veya İngilizce, Türkçe, Almanca ya da İspanyolca soru sözcüklerine bakar.

Yapay zekâ etiketleri isteğe bağlıdır: olumlu, nötr, olumsuz, soru, şikâyet, spam.

- **Ne zaman çalışır.** Yalnızca yapay zekâ açıkken ve ya **Yapay zekâ ile sınıflandır** düğmesine bastığınızda ya da `inbox.aiSentiment` ayarı açıkken.
- **Önce önizleme.** Bir şey gönderilmeden önce yorum sayısını ve tahmini token miktarını görürsünüz.
- **Ne gönderilir.** Yorumlar yerel sayısal kimliklerle 50'lik gruplar hâlinde gider.
  - Yorumcu kullanıcı adları `@user1…` ile değiştirilir.
  - Yorum metni veri olarak alıntılanır ve modele içindeki talimatlara asla uymaması söylenir.
- **Ne atlanır.** Yapay zekâyı kapatan hesaplar hiçbir zaman gönderilmez. Bir yorum yalnızca metni değişirse yeniden sınıflandırılır.

## İzinler

Aşağıdaki satırlar 2026-09'da Meta izin başvurusuna göre kontrol edildi. VERIFY ile işaretli olanlar doğrulanmamıştır.

| Platform | Okuma | Yanıt | Gizleme |
|---|---|---|---|
| Instagram | `instagram_basic`, `instagram_manage_comments` | `instagram_manage_comments` | `instagram_manage_comments` |
| Facebook Sayfası | `pages_read_engagement` + `pages_read_user_content` (kullanıcı yorumları; yoksa yazar "Facebook kullanıcısı" görünür) | `pages_manage_engagement` (MODERATE görevi olan Sayfa rolü) | `pages_manage_engagement` (VERIFY) |
| Threads | `threads_basic`, `threads_read_replies` | `threads_manage_replies` + `threads_content_publish` | `threads_manage_replies` |
| YouTube | sağlayıcı adaptörü (yanıt için `youtube.force-ssl`) | | |

- **Meta.** `pages_read_user_content` ve `pages_manage_engagement`, Meta bağlantısının isteğe bağlı izinleridir. Sayfalarda okuma ve yanıt için Meta'yı yeniden bağlayıp bu izinleri verin.
- **Threads.** Gelen kutusu izinleri, "yayımlama izinlerini iste" açıkken (Ayarlar → Bağlantılar) yayımlama izinleriyle birlikte istenir. Önce bunları uygulamanızın Threads kullanım senaryosuna ekleyin.
- **Bir izin eksikse** yanıt kutusu devre dışı kalır ve eksik izni belirtir.

## Ayarlar

Ayarlar tablosundaki aşağıdaki anahtarlar güvenli varsayılanlarla okunur:

| Anahtar | Varsayılan | Anlamı |
|---|---|---|
| `inbox.poll` | açık | Arka planda yoklama |
| `inbox.pollMinutes` | 30 | Yoklama aralığı |
| `inbox.lookbackDays` | 14 | Gönderilerin her zaman yoklandığı süre |
| `inbox.slaHours` | 24 | Yanıt hedefi |
| `inbox.aiSentiment` | kapalı | Her yoklamadan sonra yeni yorumları sınıflandır |
| `notify.inbox` | açık | Gelen kutusu bildirimleri |

## Veri

- **`comments`:** tüm platformlar için tek tablo.
  - Anahtarlar: Instagram ham kimliği, `fbc-`, `th-`, `ytc-`.
  - Ayrıca `platform`, `account_id`, `external_id`, `is_hidden` gibi alanları tutar.
- **`inbox_state`:** iş akışı durumu, atanan kişi, ilk yanıt, soru işareti ve duygu.
- **`comment_replies`:** yanıt önerileri ve giden kutusu.
  - Durum akışı: `sending` → `sent` veya `failed`.
  - Gönderim sırasında yaşanan bir çökme güvenle çözülür. Eşleşen bir hesap yanıtı varsa deneme gönderildi sayılır; yoksa yeniden deneyebilmeniz için başarısız olarak işaretlenir.

## CLI

```
metadash inbox pull [--account @x]…
metadash inbox sla [--from YYYY-MM-DD --to YYYY-MM-DD] [--platform p]… [--json]
metadash inbox list [--status open|overdue|replied|done|all] [--limit n] [--json]
```
