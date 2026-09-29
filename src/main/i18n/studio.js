/** AI studio core messages (owned by v1.5 chunk A). Format: { key: [en, tr] }. Feature chunks use i18n/studio.{voice,ideas,inbox}.js. */
export const STUDIO_MESSAGES = {
  ai_schema_invalid: ['The AI answer did not have the expected format ({detail}). Try again or pick another model.', 'Yapay zekâ yanıtı beklenen biçimde değildi ({detail}). Tekrar deneyin veya başka bir model seçin.'],
  ai_account_disabled: ['AI is turned off for {account}. No data from this account is sent to the AI provider (Studio → Voice).', '{account} için yapay zekâ kapalı. Bu hesabın hiçbir verisi yapay zekâ sağlayıcısına gönderilmez (Stüdyo → Ses).'],
  ai_vision_unavailable: ['Your model can\'t see images; describe the image in the notes.', 'Modeliniz görselleri göremiyor; görseli notlarda tarif edin.'],
  ai_vision_dropped: ['The model rejected the images, so the request was sent as text only.', 'Model görselleri kabul etmedi; istek yalnızca metin olarak gönderildi.'],
  ai_budget_exceeded: ['Estimated AI spend this month (${spent}) is over your budget (${budget}).', 'Bu ayki tahmini yapay zekâ harcaması (${spent}) bütçenizi (${budget}) aştı.'],
};
