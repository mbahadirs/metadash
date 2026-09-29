/** Headings and labels for HTML/XLSX reports. Keys → [tr, en]. English is the default. */
const D = {
  monthly: ['Aylık Müşteri Raporu', 'Monthly Client Report'],
  weekly_client: ['Haftalık Müşteri Raporu', 'Weekly Client Report'],
  custom: ['Müşteri Raporu', 'Client Report'],
  portfolio: ['Portföy Özeti', 'Portfolio Summary'],
  campaign: ['Kampanya Raporu', 'Campaign Report'],
  weekly: ['Haftalık Değişim Özeti', 'Weekly Change Digest'],
  accounts: ['hesap', 'accounts'],
  summary: ['Özet', 'Summary'],
  reach: ['Erişim', 'Reach'], views: ['Görüntülenme', 'Views'], profile_views: ['Profil ziyareti', 'Profile visits'], er: ['Etkileşim oranı', 'Engagement rate'],
  new_followers: ['Yeni takipçi', 'New followers'], followers: ['Takipçi', 'Followers'], posts: ['Gönderi', 'Posts'], save_rate: ['Kaydetme oranı', 'Save rate'],
  vs_prev: ['önceki döneme göre', 'vs. previous period'], prev: ['Önceki', 'Previous'],
  reach_engagement: ['Erişim ve etkileşim', 'Reach and engagement'], engaged: ['Etkileşen hesap', 'Accounts engaged'], follower_growth: ['Takipçi büyümesi', 'Follower growth'],
  top6: ['En iyi 6 gönderi', 'Top 6 posts'], top10: ['Portföyde en iyi 10 gönderi', 'Top 10 posts in the portfolio'], type_breakdown: ['İçerik tipi kırılımı', 'Content type breakdown'],
  type: ['Tip', 'Type'], avg_reach: ['Ort. erişim', 'Avg. reach'], avg_likes: ['Ort. beğeni', 'Avg. likes'], avg_saved: ['Ort. kaydetme', 'Avg. saves'], avg_er: ['Ort. ER', 'Avg. ER'], avg_views: ['Ort. görüntülenme', 'Avg. views'],
  best_time: ['En iyi paylaşım zamanı', 'Best time to post'], best_time_note: ['Hücre değeri: o dilimde paylaşılan gönderilerin ortalama etkileşim oranı. En az {n} gönderi olan hücreler renkli.', 'Cell value: average engagement rate of posts in that slot. Cells with at least {n} posts are coloured.'],
  stories: ['Story performansı', 'Story performance'], story_count: ['Story sayısı', 'Stories'], completion: ['Tamamlanma', 'Completion'], exit_rate: ['Çıkış oranı', 'Exit rate'],
  ads_summary: ['Reklam özeti', 'Ad summary'], spend: ['Harcama', 'Spend'], paid_reach: ['Reklam erişimi', 'Paid reach'], organic_reach: ['Organik erişim', 'Organic reach'],
  organic_paid: ['Organik + ücretli', 'Organic + paid'], results: ['Sonuç', 'Results'], cost_per_result: ['Sonuç maliyeti', 'Cost per result'], campaigns: ['Kampanyalar', 'Campaigns'],
  impressions: ['Gösterim', 'Impressions'], clicks: ['Tıklama', 'Clicks'], no_ad_account: ['Bu hesaba eşlenmiş reklam hesabı yok.', 'No ad account is linked to this account.'],
  content_analysis: ['İçerik analizi', 'Content analysis'], reach_share: ['Erişim payı', 'Share of reach'], ad: ['Reklam', 'Ads'], boosted_posts: ['Reklamlı gönderi', 'Boosted posts'], ad_spend: ['Reklam harcaması', 'Ad spend'],
  recent_posts: ['Son {n} günde paylaşılanlar', 'Posted in the last {n} days'], recent_note: ['Farklar hesabın aynı türdeki son 90 gün ortalamasına göre.', 'Deltas vs. the account\'s 90-day average for the same type.'],
  hashtags: ['Hashtag performansı', 'Hashtag performance'], hashtag: ['Hashtag', 'Hashtag'], usage: ['Kullanım', 'Uses'],
  selected_posts: ['Seçilen gönderiler', 'Selected posts'], date: ['Tarih', 'Date'], caption: ['Açıklama', 'Caption'], comments: ['Yorum', 'Comments'], saves: ['Kaydetme', 'Saves'], likes: ['Beğeni', 'Likes'],
  account: ['Hesap', 'Account'], client: ['Müşteri', 'Client'], change: ['Değişim', 'Change'], health: ['Sağlık', 'Health'], last30: ['Son 30 gün', 'Last 30 days'], league: ['Lig tablosu', 'Leaderboard'],
  attention: ['Dikkat gerektirenler', 'Needs attention'], silent: ['7+ gündür paylaşım yok', 'No posts for 7+ days'], anomalies: ['Anomaliler', 'Anomalies'], none: ['Yok', 'None'], days: ['gün', 'days'],
  weekly_digest: ['Haftalık özet', 'Weekly digest'], week_posts: ['Haftanın gönderileri', 'Posts of the week'], net_followers: ['Net takipçi', 'Net followers'],
  demographics: ['Demografi', 'Demographics'], city: ['Şehir', 'City'], country: ['Ülke', 'Country'], gender_age: ['Yaş ve cinsiyet', 'Age & gender'], female: ['Kadın', 'Female'], male: ['Erkek', 'Male'],
  health_score: ['Hesap sağlık skoru', 'Account health score'], health_note: ['Büyüme %30 + etkileşim %30 + düzenlilik %20 + yanıt oranı %20; portföy içindeki yüzdelik dilime göre.', 'Growth 30% + engagement 30% + consistency 20% + response rate 20%; percentile within the portfolio.'],
  growth: ['Büyüme', 'Growth'], engagement: ['Etkileşim', 'Engagement'], consistency: ['Düzenlilik', 'Consistency'], response: ['Yanıt oranı', 'Response rate'],
  competitors: ['Rakipler', 'Competitors'], competitor_note: ['Rakiplerde erişim verisi bulunmaz; yalnızca herkese açık sayılar gösterilir.', 'Reach is not available for competitors; only public counts are shown.'],
  posts_per_week: ['Haftalık gönderi', 'Posts / week'], avg_comments: ['Ort. yorum', 'Avg. comments'], you: ['siz', 'you'],
  commentary: ['Değerlendirme ve öneriler', 'Assessment and recommendations'],
  accounts_table: ['Hesaplar', 'Accounts'], account_detail: ['Hesap detayı', 'Account detail'],
  generated: ['MetaDash ile {d} tarihinde oluşturuldu. Veriler Meta Graph API\'den alınmıştır; bu dosya çevrimdışı açılabilir.', 'Generated with MetaDash on {d}. Data from the Meta Graph API; this file opens offline.'],
  generated_plain: ['{d} tarihinde oluşturuldu.', 'Generated on {d}.'],
  age: ['Yaş', 'Age'], gender: ['Cinsiyet', 'Gender'], platform: ['Platform', 'Platform'], breakdown: ['Reklam kırılımı', 'Ad breakdown'], period: ['Dönem', 'Period'],
  image: ['Görsel', 'Image'], carousel: ['Carousel', 'Carousel'], video: ['Video', 'Video'], reels: ['Reels', 'Reels'], story: ['Story', 'Story'],
  week_of: ['Hafta', 'Week'],
  basket: ['Seçilen Gönderiler Raporu', 'Selected Posts Report'], ad_metrics: ['Reklam metrikleri', 'Ad metrics'], comparison: ['Karşılaştırma', 'Comparison'], reach_rank: ['Erişim sırası', 'Reach rank'], paid_share: ['Ücretli erişim payı', 'Paid reach share'],
  lifecycle_note: ['Erişimin gönderi yaşına (saat) göre gelişimi; anlık görüntülerden.', 'Reach by post age (hours), from snapshots.'],
  value: ['Değer', 'Value'], currency: ['Para birimi', 'Currency'], ad_impressions: ['Reklam gösterimi', 'Ad impressions'], result_type: ['Sonuç türü', 'Result type'],
  amount_spent: ['Harcanan', 'Amount spent'], frequency: ['Sıklık', 'Frequency'], post_engagement: ['Gönderi etkileşimi', 'Post engagement'], cost_per_post_engagement: ['Gönderi etkileşimi başına ücret', 'Cost per post engagement'],
  page_engagement: ['Sayfa etkileşimi', 'Page engagement'], cost_per_page_engagement: ['Sayfa etkileşimi başına ücret', 'Cost per page engagement'], post_eng_short: ['Gönderi etk.', 'Post eng.'], cost_post_eng_short: ['Gönderi etk. ücreti', 'Cost / post eng.'],
  page_eng_short: ['Sayfa etk.', 'Page eng.'], cost_page_eng_short: ['Sayfa etk. ücreti', 'Cost / page eng.'], monthly_budget: ['Aylık bütçe', 'Monthly budget'], budget: ['Bütçe', 'Budget'],
  total_impressions: ['Toplam gösterim', 'Total impressions'], paid_impression_share: ['Ücretli gösterim payı', 'Paid impression share'], total_reach: ['Toplam erişim', 'Total reach'], chars_short: ['kar.', 'chars'],
  daily: ['Günlük', 'Daily'], replies: ['Yanıt', 'Replies'], nav_forward: ['İleri', 'Forward'], nav_back: ['Geri', 'Back'], nav_exit: ['Çıkış', 'Exits'], dimension: ['Boyut', 'Dimension'], name: ['Ad', 'Name'],
  mean: ['Ortalama', 'Mean'], direction: ['Yön', 'Direction'], days_since_post: ['Son gönderi (gün)', 'Days since last post'], adsets: ['Reklam setleri', 'Ad sets'], ads_list: ['Reklamlar', 'Ads'],
  type_avg: ['tür ort.', 'type avg.'], views_per_reach: ['Görüntülenme/erişim', 'Views/reach'], interactions_per_k: ['Etkileşim/1000 erişim', 'Interactions/1000 reach'], post_count_28: ['Gönderi sayısı (28g)', 'Posts (28d)'],
  hours_to_80: ['%80 saat', 'Hours to 80%'], post_slot: ['Paylaşım dilimi', 'Posting slot'], slot_er: ['Dilim ER %', 'Slot ER %'], bench_posts: ['Kıyas gönderi', 'Benchmark posts'], bench_reach: ['Kıyas ort. erişim', 'Benchmark avg. reach'],
  bench_er: ['Kıyas ort. ER %', 'Benchmark avg. ER %'], char_count: ['Karakter', 'Characters'], ad_count: ['Reklam sayısı', 'Ad count'], lifecycle: ['Yaşam eğrisi', 'Lifecycle'], age_hours: ['Yaş (saat)', 'Age (hours)'],
  captured: ['Ölçüm', 'Captured'], ad_name: ['Reklam', 'Ad'], ad_account: ['Reklam hesabı', 'Ad account'], first_day: ['İlk gün', 'First day'], last_day: ['Son gün', 'Last day'],
  heat_tip: ['{n} gönderi, ER {v}', '{n} posts, ER {v}'], weekdays: ['Paz,Pzt,Sal,Çar,Per,Cum,Cmt', 'Sun,Mon,Tue,Wed,Thu,Fri,Sat'],
  viewers: ['Görüntüleyen', 'Viewers'], reposts: ['Yeniden paylaşım', 'Reposts'], quotes: ['Alıntı', 'Quotes'], link_clicks: ['Bağlantı tıklaması', 'Link clicks'],
  post_engagements: ['Gönderi etkileşimi', 'Post engagements'], page_views: ['Sayfa görüntüleme', 'Page views'], unfollows: ['Takibi bırakan', 'Unfollows'], shares: ['Paylaşım', 'Shares'],
  instagram: ['Instagram', 'Instagram'], facebook: ['Facebook', 'Facebook'], threads: ['Threads', 'Threads'], text: ['Metin', 'Text'],
  views_engagement: ['Görüntülenme ve etkileşim', 'Views and engagement'], reach_or_views: ['Erişim / görüntülenme', 'Reach / views'],
  gender_unknown: ['Belirtilmemiş', 'Unspecified'], mixed_platforms_note: ['Farklı platformlar birlikte gösteriliyor: Threads\'te erişim yok, yerine görüntülenme kullanılır; kaydetme yalnızca Instagram\'da.', 'Platforms are mixed: Threads has no reach (views are used instead); saves exist on Instagram only.'],
  health_note_no_response: ['Büyüme %37,5 + etkileşim %37,5 + düzenlilik %25 (bu platformda yorum verisi yok); aynı platformdaki hesaplar içinde yüzdelik dilime göre.', 'Growth 37.5% + engagement 37.5% + consistency 25% (no comment data on this platform); percentile among accounts on the same platform.'],
  bench_note: ['Farklar hesabın aynı türdeki ({t}, {n} gönderi) son {d} gün ortalamasına göre.', 'Deltas vs. the account\'s {d}-day average for the same type ({t}, {n} posts).'], compare_prev: ['Önceki dönem: {a} – {b}', 'Previous period: {a} – {b}'],
};

/** KPI key (accountAnalytics kpis) → label key; Facebook calls reach "Viewers" and profile views "Page views". */
const KPI_LABEL = {
  reach: (p) => (p === 'facebook' ? 'viewers' : 'reach'), views: 'views', profileViews: (p) => (p === 'facebook' ? 'page_views' : 'profile_views'),
  er: 'er', saveRate: 'save_rate', newFollowers: 'new_followers', posts: 'posts', postEngagements: 'post_engagements',
  likes: 'likes', replies: 'replies', reposts: 'reposts', quotes: 'quotes', linkClicks: 'link_clicks', engaged: 'engaged',
};
/** Daily metric (account_insights_daily name) → label key. */
const METRIC_LABEL = {
  reach: KPI_LABEL.reach, views: 'views', profile_views: KPI_LABEL.profileViews, accounts_engaged: 'engaged', post_engagements: 'post_engagements',
  likes: 'likes', replies: 'replies', reposts: 'reposts', quotes: 'quotes', link_clicks: 'link_clicks', unfollows: 'unfollows', follower_count: 'new_followers',
};
const resolve = (map, key, platform) => { const v = map[key]; return typeof v === 'function' ? v(platform) : v ?? key; };
export const kpiLabelKey = (key, platform = 'instagram') => resolve(KPI_LABEL, key, platform);
export const metricLabelKey = (metric, platform = 'instagram') => resolve(METRIC_LABEL, metric, platform);

export function makeL(lang = 'en') {
  const idx = lang === 'tr' ? 0 : 1;
  return (key, vars) => {
    let s = D[key]?.[idx] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/** Short weekday names, Sunday first. */
export const weekdays = (lang) => makeL(lang)('weekdays').split(',');
