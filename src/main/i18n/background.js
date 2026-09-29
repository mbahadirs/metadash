/** Tray/background/lifecycle, slot-suggestion and approval-pack messages (owned by v1.4 chunk C). Format: { key: [en, tr] }. */
export const BACKGROUND_MESSAGES = {
  // tray menu
  tray_tooltip: ['MetaDash', 'MetaDash'],
  tray_today: ['{n} posts left today', 'Bugün {n} gönderi kaldı'],
  tray_pause: ['Pause publishing', 'Yayınlamayı duraklat'],
  tray_resume: ['Resume publishing', 'Yayınlamayı sürdür'],
  tray_paused: ['Publishing is paused', 'Yayınlama duraklatıldı'],
  tray_sync: ['Sync now', 'Şimdi güncelle'],
  tray_open: ['Open MetaDash', 'MetaDash\'i aç'],
  tray_planner: ['Open Planner', 'Planlayıcıyı aç'],
  tray_quit: ['Quit MetaDash', 'MetaDash\'ten çık'],
  // quit confirmation / first close
  bg_quit_confirm_title: ['Quit MetaDash?', 'MetaDash kapatılsın mı?'],
  bg_quit_confirm_body: ['{n} scheduled posts are due in the next 2 hours and won\'t publish while MetaDash is closed. Posts scheduled on Facebook itself are not affected.', 'Önümüzdeki 2 saat içinde {n} planlı gönderi var ve MetaDash kapalıyken yayınlanmayacak. Doğrudan Facebook\'ta planlanan gönderiler etkilenmez.'],
  bg_quit_anyway: ['Quit anyway', 'Yine de çık'],
  bg_cancel: ['Cancel', 'Vazgeç'],
  bg_tray_hint_title: ['MetaDash is still running', 'MetaDash çalışmaya devam ediyor'],
  bg_tray_hint_body: ['It stays in the tray so scheduled posts can be published. Use Quit in the tray menu to close it completely.', 'Planlı gönderilerin yayınlanabilmesi için sistem tepsisinde kalıyor. Tamamen kapatmak için tepsi menüsündeki Çık\'ı kullanın.'],
  bg_tray_hint_body_mac: ['It stays in the menu bar so scheduled posts can be published. Use Quit in the menu bar icon to close it completely.', 'Planlı gönderilerin yayınlanabilmesi için menü çubuğunda kalıyor. Tamamen kapatmak için menü çubuğu simgesindeki Çık\'ı kullanın.'],
  bg_login_item_failed: ['Could not change the launch-at-login setting: {detail}', 'Oturum açılışında başlatma ayarı değiştirilemedi: {detail}'],
  // approval packs
  approval_code_invalid: ['This is not a valid MetaDash response code. Paste the whole code starting with MDAP1.', 'Bu geçerli bir MetaDash yanıt kodu değil. MDAP1 ile başlayan kodun tamamını yapıştırın.'],
  approval_code_mismatch: ['The response code does not match its approval pack (it may be damaged or edited).', 'Yanıt kodu onay paketiyle eşleşmiyor (bozulmuş veya düzenlenmiş olabilir).'],
  approval_pack_unknown: ['This response belongs to an approval pack that is not in this database.', 'Bu yanıt, bu veritabanında olmayan bir onay paketine ait.'],
  approval_no_posts: ['No posts to include in the approval pack.', 'Onay paketine eklenecek gönderi yok.'],
  approval_too_many: ['An approval pack can hold at most {max} posts. Narrow the selection.', 'Bir onay paketi en fazla {max} gönderi içerebilir. Seçimi daraltın.'],
  approval_file_html: ['Approval pack (HTML)', 'Onay paketi (HTML)'],
  approval_file_pdf: ['Approval pack (PDF)', 'Onay paketi (PDF)'],
  approval_default_name: ['approval-pack', 'onay-paketi'],
};
