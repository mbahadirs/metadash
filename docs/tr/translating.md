# MetaDash'i çevirmek

[English](../translating.md)

MetaDash **İngilizce** ve **Türkçe** olarak eksiksizdir. **Almanca** ve **İspanyolca** kısmidir: henüz çevrilmemiş her metin İngilizce gösterilir. Çeviriler düz JSON dosyalarıdır; katkı vermek için uygulamayı çalıştırmanız gerekmez, ancak sonucu uygulamada kontrol etmeniz önerilir.

## Dosya düzeni

```
src/main/locales/index.json                    diller: kod, yerel ad, Intl yerel ayarı, kısmi işareti
src/renderer/locales/<dil>/<ad-alanı>.json     uygulama arayüzü (menüler, düğmeler, sayfalar)
src/main/locales/<dil>/<ad-alanı>.json         ana süreç mesajları, hatalar, rapor ve onay paketi etiketleri
```

Her dosya düz bir `"anahtar": "metin"` nesnesidir. Kaynak İngilizcedir (`en`): her anahtar önce orada bulunmalıdır. Dosyalar özelliğe (ad alanına) göre ayrılmıştır; böylece farklı özellikler üzerinde çalışanlar aynı dosyayı düzenlemez:

| Arayüz ad alanı | İçerik |
| --- | --- |
| `core` | Gezinme, ortak etiketler, panolar, kurulum, ayarlar |
| `planner` | İçerik planlayıcı ve onaylar |
| `background` | Tepsi ve arka plan modu, yayın ayarları |
| `studio`, `studio.voice`, `studio.ideas`, `studio.inbox` | Yapay zekâ stüdyosu |

| Ana süreç ad alanı | İçerik |
| --- | --- |
| `messages` | Genel mesajlar (kurulum, güncelleme, yapay zekâ hataları) |
| `errors` | Meta/ağ hata mesajları ve ipuçları |
| `planner`, `publishing`, `background`, `studio*` | Özellik mesajları |
| `report` | HTML, PDF ve Excel raporlarındaki başlık ve etiketler (`weekdays` Pazar ile başlayan, virgülle ayrılmış bir listedir) |
| `approval` | Müşteri onay paketindeki etiketler |

Arayüzdeki anahtarlar ve ana süreçteki mesaj türü ad alanlarının anahtarları tek bir anahtar alanını paylaşır: bir anahtar yalnızca bir ad alanında bulunabilir. `report` ve `approval` ayrı belgelerdir ve aynı adları kullanabilir.

## Mevcut bir dili çevirmek

1. İngilizce dosyayı ve kendi dilinizdeki karşılığını yan yana açın.
2. Çevirmek istediğiniz anahtarları kendi dosyanıza kopyalayıp İngilizce metni değiştirin. Anahtarları değiştirmeyin.
3. `npm run i18n:check` çalıştırıp bildirilen sorunları düzeltin.
4. Sonucu uygulamada kontrol edin: Ayarlar → Tema · Dil.

Her şeyi bir seferde çevirmeniz gerekmez. Eksik anahtarlar İngilizceye döner; `i18n:check` her dil için çevrilmiş yüzdeyi yazdırır.

## Yeni dil eklemek

1. `src/main/locales/index.json` dosyasına bir kayıt ekleyin, örneğin:
   ```json
   { "code": "fr", "name": "Français", "englishName": "French", "dir": "ltr", "intl": "fr-FR", "reportIntl": "fr-FR", "dateFns": "fr", "partial": true }
   ```
   `name` dil seçicide görünür, `englishName` yapay zekâ asistanına hangi dilde yazacağını söyler, `intl` / `reportIntl` sayı ve tarih biçimlerini belirler.
2. `src/renderer/locales/fr/` ve `src/main/locales/fr/` klasörlerini, her İngilizce ad alanı için bir dosya olacak şekilde oluşturun (başlangıçta boş `{}` yeterlidir).
3. Çevirin, `npm run i18n:check` çalıştırın ve bir pull request açın. Dil tamamlandığında `"partial": true` satırını kaldırın.

Bölgesel varyantlar (ör. `de-AT`) önce temel dile (`de`), sonra İngilizceye döner.

## Yer tutucular

Süslü parantez içindeki metni uygulama doldurur: `"{n} gönderi"`, `"@{u} olarak bağlı"`. İngilizcedeki her yer tutucuyu aynen koruyun ve yenisini eklemeyin. Cümle içindeki yerlerini değiştirebilirsiniz. Yer tutucular farklıysa `i18n:check` başarısız olur.

## Üslup ve sözlük

- Kısa, sade ve samimi. Düğmeler fiildir ("Kaydet", "Bağlan").
- Dilinizde yazılımlar için olağan olan hitap biçimini seçin ve tutarlı kullanın. Türkçede "siz" kullanılır.
- Platform ve ürün adları asla çevrilmez: Instagram, Facebook, Threads, Meta, Reels, Stories, MetaDash, Graph API Explorer.
- Token, App ID, App Secret, API ve hashtag gibi yaygın teknik terimler, dilinizde yerleşik bir karşılığı yoksa İngilizce kalır.
- Metrik adları, varsa platformun kendi dilinizdeki adlandırmasını izler (örneğin Facebook erişimi için "İzleyenler").

## Kontroller

```bash
npm run i18n:check                     # eksik / fazla anahtar, yer tutucu uyuşmazlığı, yinelenen anahtar, kodda kullanılan tanımsız anahtar
node scripts/i18n-check.mjs --unused   # ayrıca kodda doğrudan geçmeyen anahtarları listeler (bilgi amaçlı)
```

İngilizce ile Türkçe farklıysa, herhangi bir dilde yer tutucular uyuşmuyorsa ya da kod İngilizcede tanımlı olmayan bir anahtar kullanıyorsa kontrol başarısız olur. Kısmi diller için yalnızca yüzde gösterilir.

## Geliştiriciler için

- Arayüz: `src/renderer/lib/i18n.ts` içindeki `t('anahtar', dil?, değişkenler?)` ve `useT()`. `Key` türü İngilizce JSON dosyalarından üretilir (`src/renderer/locales/keys.ts`); anahtardaki bir yazım hatası tür hatası verir.
- Ana süreç: `src/main/i18n.js` içindeki `msg('anahtar', değişkenler, dil?)`; raporlar `src/main/export/reportI18n.js` içindeki `makeL(dil)` ile çalışır. Saf modüller `src/main/locales/catalog.js` içindeki `translate()` fonksiyonunu kullanabilir.
- Biçimlendirme: dil kodlarını karşılaştırmak yerine `Intl` için `intlLocale(dil)` / `locale()`, dışa aktarılan belgelerde `reportLocale(dil)` kullanın.
- Yeni ad alanı: ilgili tarafta her dil için `<ad-alanı>.json` ekleyin. Arayüzde ayrıca `src/renderer/locales/keys.ts` içindeki birleşime ekleyin. Ana süreçte otomatik olarak yüklenir (`catalog.js` içindeki `DOCUMENT_NAMESPACES` listesinde değilse `msg()` ile birleştirilir).
