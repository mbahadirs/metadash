export const RETRYABLE_CODES = new Set([4, 17, 32, 613]);

export class MetaError extends Error {
  constructor({ code, subcode, message, type, endpoint, status, source }) {
    super(message);
    this.name = 'MetaError';
    this.code = code ?? null;
    this.subcode = subcode ?? null;
    this.type = type ?? null;
    this.endpoint = endpoint ?? null;
    this.status = status ?? null;
    this.source = source ?? null; // client name that raised it: 'meta' | 'threads'
  }

  get isRetryable() {
    return RETRYABLE_CODES.has(this.code);
  }
  get isTokenError() {
    return this.code === 190 || this.code === 102;
  }
  get isPermissionError() {
    return this.code === 10 || this.code === 200 || (this.code >= 200 && this.code <= 299);
  }
  get isInvalidParam() {
    return this.code === 100;
  }
}

export class NetworkError extends Error {
  constructor(message, endpoint) {
    super(message);
    this.name = 'NetworkError';
    this.endpoint = endpoint;
    this.code = 'NETWORK';
  }
}

const PERMISSION_HINTS = {
  insights: 'instagram_manage_insights',
  media: 'instagram_basic',
  adaccounts: 'ads_read',
  accounts: 'pages_show_list',
};

/** Translates any error into the user-facing envelope { code, message, hint }. */
export function toUserError(err, lang = 'en') {
  const tr = lang === 'tr';
  if (err instanceof NetworkError || err?.code === 'NETWORK' || err?.name === 'FetchError' || err?.cause?.code === 'ENOTFOUND') {
    return {
      code: 'NETWORK',
      message: tr ? 'İnternet bağlantısı yok. Mevcut veriler görüntülenmeye devam ediyor.' : 'No internet connection. Existing data remains available.',
      hint: tr ? 'Bağlantı geldiğinde Güncelle düğmesine basın.' : 'Press Update once the connection is back.',
    };
  }
  if (err instanceof MetaError) {
    if (err.isTokenError && err.source === 'threads') {
      return {
        code: err.code,
        message: tr ? 'Threads bağlantınızın süresi doldu veya geçersiz. Ayarlar > Bağlantılar\'dan yeniden bağlayın.' : 'Your Threads connection has expired or is invalid. Reconnect it in Settings > Connections.',
        hint: tr ? 'Threads adımına dönüp yeni bir token veya kod yapıştırın.' : 'Go back to the Threads step and paste a new token or code.',
      };
    }
    if (err.isTokenError) {
      return {
        code: err.code,
        message: tr ? 'Meta bağlantınızın süresi doldu. Ayarlar > Bağlantı\'dan yenileyin.' : 'Your Meta connection has expired. Renew it in Settings > Connection.',
        hint: tr ? 'Kurulumun 3. adımına dönüp yeni bir token alın.' : 'Go back to setup step 3 and obtain a new token.',
      };
    }
    if (err.isRetryable) {
      return {
        code: err.code,
        message: tr ? 'Meta geçici olarak istek sınırına ulaştı. Güncelleme otomatik olarak yavaşlatıldı.' : 'Meta reached a temporary rate limit. Updates were slowed automatically.',
        hint: tr ? 'Birkaç dakika sonra tekrar deneyin.' : 'Try again in a few minutes.',
      };
    }
    if (err.isPermissionError) {
      const perm = guessPermission(err.endpoint);
      return {
        code: err.code,
        message: tr ? `Bu veri için ${perm} izni gerekiyor. Kurulum adımlarını tekrarlayın.` : `This data requires the ${perm} permission. Repeat the setup steps.`,
        hint: tr ? 'Graph API Explorer\'da izni ekleyip yeni token alın.' : 'Add the permission in Graph API Explorer and obtain a new token.',
      };
    }
    if (err.isInvalidParam) {
      return {
        code: err.code,
        message: tr ? `Meta isteği reddetti: ${err.message}` : `Meta rejected the request: ${err.message}`,
        hint: tr ? 'Desteklenmeyen metrikler Ayarlar\'da listelenir.' : 'Unsupported metrics are listed in Settings.',
      };
    }
    return { code: err.code, message: err.message, hint: tr ? 'Sorun sürerse token\'ı yenileyin.' : 'If this persists, renew the token.' };
  }
  return {
    code: err?.code ?? 'UNKNOWN',
    message: err?.message ?? (tr ? 'Beklenmeyen bir hata oluştu.' : 'An unexpected error occurred.'),
    hint: null,
  };
}

function guessPermission(endpoint = '') {
  for (const [needle, perm] of Object.entries(PERMISSION_HINTS)) {
    if (endpoint.includes(needle)) return perm;
  }
  return 'instagram_manage_insights';
}
