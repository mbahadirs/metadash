# MetaDash belgeleri

[English](../README.md)

MetaDash 2.0 rehberleri. Genel bakış, indirmeler ve hızlı başlangıç için önce [README](../../README.tr.md) dosyasına bakın.

## Başlarken

| Rehber | Kapsamı |
| --- | --- |
| [README: Hızlı başlangıç](../../README.tr.md#hızlı-başlangıç) | Demo modu, 7 adımlı kurulum sihirbazı ve diğer platformları bağlama |
| [README: Veri ve gizlilik](../../README.tr.md#veri-ve-gizlilik) | Verilerin nerede saklandığı ve bilgisayarınızdan neyin çıktığı |
| [Bilinen sınırlamalar](known-limitations.md) | Platform API'lerinin vermedikleri, MetaDash'in varsaydığı API davranışları ve diğer sınırlar |

## Platform kurulumu

| Rehber | Platformlar |
| --- | --- |
| [Meta uygulaması kurulumu](meta-app-setup.md) | Instagram, Facebook Sayfaları, Meta reklamları (tek Meta uygulaması ve token) |
| [Threads kurulumu](threads-setup.md) | Threads (ayrı uygulama bilgileri ve token) |
| [YouTube kurulumu](youtube-setup.md) | YouTube (kendi Google OAuth "Masaüstü uygulaması" istemciniz) |
| [TikTok kurulumu](tiktok-setup.md) | TikTok, deneysel (kendi TikTok geliştirici uygulamanız) |

## Özellikler

| Rehber | Kapsamı |
| --- | --- |
| [Planlayıcı](planner.md) | Takvim, düzenleyici, iş akışı, müşteri onay paketleri, arka planda çalışma |
| [Yayımlama kurulumu](publishing-setup.md) | Yayımlama izinleri, medya barındırıcıları (S3 uyumlu, Facebook Sayfası, zaten barındırılan), sınırlar, bilgisayar kapalıyken neyin çalıştığı |
| [Yapay Zekâ Stüdyosu](ai-studio.md) | Marka sesi, açıklamalar, hashtag'ler, fikirler, dönüştürme, yanıt önerileri, deneyler ve yapay zekâ sağlayıcısına neyin gönderildiği |
| [Birleşik gelen kutusu](inbox.md) | Tüm platformların yorumları, yanıtlar, yanıt süresi metrikleri, duygu analizi, izinler |

## İleri düzey

| Rehber | Kapsamı |
| --- | --- |
| [Ekip çalışma alanı ve roller](team.md) | Çalışma alanını eşitlenen bir klasörle paylaşma, roller, müşteri görünümü, notlar ve @bahsetmeler |
| [Komut satırı aracı](cli.md) | Penceresiz `sync`, `report`, `export`, `backup`, `status` ve cron, launchd veya Görev Zamanlayıcı ile zamanlama |
| [Kendi sunucunuzda yayın worker'ı](worker.md) | Bilgisayarınız kapalıyken yayımlayan Docker servisi: kurulum, TLS, protokol, tehdit modeli |

## Katkıda bulunma

| Rehber | Kapsamı |
| --- | --- |
| [Katkıda bulunma](../../CONTRIBUTING.md) | Geliştirme ortamı, denetimler, kodlama kuralları, commit mesajları (İngilizce) |
| [Mimari](architecture.md) | Süreç modeli, IPC, veritabanı, sağlayıcılar, senkronizasyon, dışa aktarımlar, güvenlik modeli |
| [Platform ekleme](providers.md) | Sağlayıcı arayüzü, yetenekler, yetkilendirme kalıpları, testler ve tamamlanma ölçütleri |
| [Çeviri](translating.md) | Dil JSON dosyaları, yeni dil ekleme, `npm run i18n:check` |
| [Güvenlik politikası](../../SECURITY.md) | Güvenlik açığı bildirme, kapsam, token'ların nasıl işlendiği (İngilizce) |
| [Değişiklik günlüğü](../../CHANGELOG.md) | Sürüm notları (İngilizce) |
