import type { Envelope, ApiError } from './types';
import { t } from './i18n';

export class ApiCallError extends Error {
  code: string | number;
  hint: string | null;
  constructor(e: ApiError) {
    super(e.message);
    this.code = e.code;
    this.hint = e.hint;
  }
}

/** Unwraps the IPC envelope; throws ApiCallError so TanStack Query surfaces it. */
export async function call<T>(p: Promise<Envelope<T>>): Promise<T> {
  const res = await p;
  if (!res) throw new ApiCallError({ code: 'EMPTY', message: t('empty_response'), hint: null });
  if (!res.ok) throw new ApiCallError(res.error);
  return res.data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApi = any;
declare global {
  interface Window { api: AnyApi }
}

export const api: AnyApi = window.api;
