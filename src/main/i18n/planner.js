/** Planner messages (v1.4 chunk A; chunk C may append approval/suggest keys here). Format: { key: [en, tr] }. */
export const PLANNER_MESSAGES = {
  planner_post_not_found: ['Planned post not found.', 'Planlanan gönderi bulunamadı.'],
  planner_version_conflict: ['This post was changed elsewhere. Reload it and try again.', 'Bu gönderi başka bir yerde değiştirildi. Yeniden yükleyip tekrar deneyin.'],
  planner_post_locked: ['This post is being published or already published and cannot be changed.', 'Bu gönderi yayımlanıyor veya zaten yayımlandı; değiştirilemez.'],
  planner_target_locked: ['An account that is already scheduled on the platform or publishing cannot be removed. Unschedule the post first.', 'Platformda zamanlanmış veya yayımlanmakta olan bir hesap kaldırılamaz. Önce zamanlamayı kaldırın.'],
  planner_invalid_payload: ['Invalid planner request: {field}', 'Geçersiz planlayıcı isteği: {field}'],
  planner_account_unknown: ['Unknown account: {id}', 'Bilinmeyen hesap: {id}'],
  planner_format_invalid: ['The format "{format}" is not available for {platform}.', '"{format}" biçimi {platform} için kullanılamıyor.'],
  planner_time_past: ['The scheduled time is in the past.', 'Planlanan zaman geçmişte.'],
  planner_status_use_publishing: ['Use Schedule / Unschedule to change the schedule state.', 'Zamanlama durumunu değiştirmek için Zamanla / Zamanlamayı kaldır kullanın.'],
  planner_asset_not_found: ['Media file not found.', 'Medya dosyası bulunamadı.'],
  planner_asset_unsupported: ['Unsupported file: {name}. Use JPEG, PNG, WebP, GIF, MP4 or MOV.', 'Desteklenmeyen dosya: {name}. JPEG, PNG, WebP, GIF, MP4 veya MOV kullanın.'],
  planner_asset_too_large: ['The file is too large ({mb} MB).', 'Dosya çok büyük ({mb} MB).'],
  planner_asset_in_use: ['This media file is used by {n} post(s) and cannot be removed.', 'Bu medya dosyası {n} gönderide kullanılıyor ve kaldırılamaz.'],
  planner_asset_missing_file: ['The media file is missing on disk.', 'Medya dosyası diskte bulunamadı.'],
  planner_media_filter: ['Images and videos', 'Görseller ve videolar'],
};
