const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function analyzeCaption(caption = '') {
  const text = caption ?? '';
  return {
    captionLength: text.length,
    hashtagCount: (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length,
    mentionCount: (text.match(/@[\p{L}\p{N}_.]+/gu) ?? []).length,
    emojiCount: (text.match(EMOJI_RE) ?? []).length,
  };
}
