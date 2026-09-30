# Ekip çalışma alanı ve roller (sunucusuz)

MetaDash v2.0, küçük bir ekibin tek bir çalışma alanını bilgisayarları arasında zaten eşitlenen bir klasör
üzerinden paylaşmasını sağlar: Dropbox, iCloud Drive, OneDrive, masaüstü Google Drive veya bir NAS/SMB paylaşımı.
MetaDash sunucusu ya da hesap sistemi yoktur.

> **Roller güvenlik değil, korkuluktur.** Roller ve müşteri görünümü, denetiminizde olmayan bir makinede iş akışını
> yönlendiren korkuluklardır; bir güvenlik sınırı değildir. Anlık görüntü dosyasına sahip olan veya çalışma alanı
> açıkken bilgisayarı kullanan herkes verileri okuyabilir. Şifreleme paylaşılan klasörü korur, çalışma alanının
> açıldığı bir bilgisayarı korumaz. Verinin tamamını görmemesi gereken kişilerle çalışma alanı paylaşmayın.

## Model

- **Yayımlayan** (tek kurulum, yönetici): token'ları saklar, eşitlemeyi çalıştırır ve veritabanının ayıklanmış bir
  anlık görüntüsünü paylaşılan klasöre yazar. Her başarılı eşitlemeden sonra ve en az saatte bir yayımlar.
- **Aboneler** (istenen sayıda): en son anlık görüntüyü kendi kopyalarında **salt okunur** açar. Abonelerde token
  olmadığı için eşitleme, kurulum, yorum yanıtlama/gizleme ve gönderi yayımlama kapalıdır.
- **İş birliği** (notlar, @bahsetmeler, gelen kutusu durumu ve atama), **üye başına yalnızca eklenen olay
  günlükleriyle** taşınır. Her dosyanın tek bir yazarı vardır, bu yüzden eşitleme çakışması oluşmaz. Birleştirme her
  not veya yorum için "son yazan kazanır" kuralıyla yapılır; silinen notlar için mezar taşı tutulur. Olayların
  uygulanması idempotenttir.

## Kurulum

1. Herkes: **Ayarlar → Ekip → Kimliğiniz** bölümünden ad ve kullanıcı adı (`@kullanici`, bahsetmeler için) girer.
2. Yayımlayan (yönetici): **Ekip oluştur**. Eşitlenen klasörü seçin, ekibe bir ad verin ve isterseniz anlık
   görüntüleri bir parolayla (en az 8 karakter) şifreleyin. Parolayı ekip arkadaşlarınızla klasörün **dışında**
   paylaşın.
3. Ekip arkadaşları: **Ekibe katıl**. Aynı eşitlenen klasörü seçin (klasörün kendisi, içindeki `MetaDash` klasörü
   veya ekip klasörü olabilir) ve ekip şifreliyse parolayı girin.

Abone, *"Paylaşılan çalışma alanı, … tarafından … itibarıyla veriler"* şeridini gösterir. Klasörü her dakika ve
pencere odağa geldiğinde denetler (bulut klasörlerinde `fs.watch` güvenilir değildir). **Güncellemeleri denetle**
hemen denetler.

**Ekipten ayrıl**, aboneyi abonelik boyunca hiç değişmeyen kendi veritabanına döndürür. Paylaşılan verilerin yerel
kopyası saklanabilir veya silinebilir. Ayrılan yayımlayan verilerini korur ve yayımlamayı bırakır; klasöre dokunulmaz.

## Paylaşılan klasörde neler var

```
<paylaşılan>/MetaDash/<teamId>/
  team.json                              ekip adı, biçim sürümü, yayımlayan kimliği, şifreleme tuzu + anahtar denetimi
  snapshot/manifest.json                 geçerli anlık görüntü kimliği, dosya, sha256, boyut, şema sürümü, uygulama sürümü, zaman
  snapshot/<id>.metadash[.enc]           son 3 anlık görüntü
  members/<memberId>.json                ad, kullanıcı adı, rol (bilgi amaçlı)
  events/<memberId>.jsonl                o üyenin not / gelen kutusu durumu / bahsetme görüldü olayları
```

Önce anlık görüntü yazılır (geçici dosya, fsync, yeniden adlandırma), manifest ancak ondan sonra değiştirilir.
Bulut istemcileri büyük dosyaları parça parça eşitlediği için aboneler, anlık görüntünün boyutu ve sha256 değeri
manifestle eşleşene kadar bekler. Daha yeni bir MetaDash ile yayımlanmış (şema sürümü daha yüksek) bir anlık görüntü
açılmaz; şerit güncelleme yapmanızı ister. Çakışma kopyaları (`… (conflicted copy …)`, `ad (1).uzantı`,
`ad 2.uzantı`) yok sayılır.

### Klasöre asla yazılmayanlar

- Hiçbir gizli bilgi (`token:*`): Meta/Threads/YouTube/TikTok token'ları, uygulama gizli anahtarları, yapay zekâ ve
  S3 anahtarları. Profillerdeki token referansları boşaltılır.
- Küçük bir izin listesi (rapor markalaması, kurulum durumu, demo bayrağı, kapatılan metrikler) dışındaki ayarlar.
  Diliniz, temanız, bildirim tercihleriniz ve yapay zekâ ayarlarınız bilgisayarınızda kalır.
- Yapay zekâ geçmişi, eşitleme hata günlükleri, API kota ve kilit kayıtları, çalışan (worker) token'ları,
  gönderilmemiş yanıt taslakları ve "bahsetme görüldü" işaretleriniz.

### Şifreleme

İsteğe bağlıdır. Anlık görüntünün tamamı şifrelenir (1 MB'lık parçalarda AES-256-GCM, dosya başlığı `MDX1`). Anahtar,
ekip parolasından scrypt ile türetilir. `team.json` parolayı değil, yalnızca tuzu ve anahtar denetimini saklar. Her
kurulum türetilen anahtarı kendi makine anahtarıyla şifreleyerek saklar. Olay günlükleri ve üye dosyaları şifrelenmez.
Klasörün kendisine güvenmiyorsanız notlara gizli bilgi yazmayın.

## Abonede makineye özel ayarlar

Abonelik süresince makineye özel ayarlar `userData/local.db` içinde tutulur, böylece çalışma alanı veritabanının
değiştirilmesi bunları hiçbir zaman kaybettirmez. Bunlar `lang`, `theme`, `ui.*`, `team.*`, `notify.*`,
`session.*`, `ai.*`, `app.*`, `token:team:*` ve `token:ai:*` anahtarlarıdır. Paylaşılan kopyanın kendisi
`userData/workspaces/<teamId>/data.db` dosyasıdır.

## Roller

| Rol | Nerede | Yapabilecekleri |
|---|---|---|
| Yönetici | kendi kurulum (varsayılan) | her şey |
| Analist | aboneler (varsayılan) veya kendi kurulumda seçilerek | analiz, raporlar, notlar, gelen kutusu durumu, planlayıcı; kurulum, gizli bilgiler, `settings` (arayüz, dil, tema ve bildirimler hariç), aktarım, yedekleme/geri yükleme, yayın çalışanı ve ekip oluşturma **hariç** |
| Müşteri | "Müşteriye sun" | yalnızca seçilen müşterilerin hesapları, analizler, rapor önizleme/dışa aktarma ve *Müşteriye açık* notlar |

`members/<id>.json` içindeki rol bilgi amaçlıdır. Her kurulum kendi rolüne kendisi karar verir. Abone hiçbir zaman
yönetici olamaz.

### Müşteriye sun

**Ayarlar → Ekip → Müşteriye sun**: bir veya daha fazla müşteri adı (hesaplardaki *Müşteri* alanı) ve 4-8 haneli bir
PIN seçin. Gezinme menüsünde Ayarlar, Kurulum, Sor, Gelen kutusu, Planlayıcı, SQL, Rakipler, Stüdyo ve Reklamlar
gizlenir. Tüm hesap listeleri ve isteklerdeki her hesap/gönderi kimliği bu müşterilerle sınırlanır. Çıkmak için PIN
gerekir. Beş hatalı PIN girişinden sonra istem 30 saniye kilitlenir. Müşteri görünümü yeniden başlatmadan sonra da
açık kalır.

## Notlar ve @bahsetmeler

Hesaplardaki, gönderilerdeki ve gelen kutusu yorumlarındaki notlar yazarı, zamanı ve bir görünürlük etiketini
(*Dahili* veya *Müşteriye açık*) gösterir. Bir ekip arkadaşını seçmek için `@` yazın; elle yazılan kullanıcı adları da
tanınır. Sizden bahsedildiğinde masaüstü bildirimi (Ayarlar → Bildirimler) alırsınız ve Ayarlar → Ekip'te bir
Bahsetmeler rozeti görünür. Bir notu yalnızca yazarı veya bir yönetici düzenleyip silebilir.

## Komut satırı

```
metadash team status      # mod, ekip, son yayım/kontrol, üyeler
metadash team publish     # yayımlayan: şimdi anlık görüntü yayımla   (abonede çıkış kodu 6)
metadash team pull        # abone: en son anlık görüntüyü ve olayları şimdi al
```

## Sorun giderme

- *"Anlık görüntü hâlâ eşitleniyor"*: eşitleme istemcisinin bitmesini bekleyin, sonra yeniden denetleyin.
- *"Ekip parolası hatalı"*: `team.json` içindeki anahtar denetimi eşleşmedi. Hiçbir şey değiştirilmedi.
- *"Daha yeni bir MetaDash ile yayımlanmış"*: bu bilgisayardaki MetaDash'i güncelleyin.
- İki yayımlayan: yalnızca ekibi oluşturan kurulum yayımlar. Başka bir kurulum aynı klasörde ekip oluşturursa kendi
  `<teamId>` klasörünü alır.
