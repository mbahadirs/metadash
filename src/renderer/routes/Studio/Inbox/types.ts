import type { InboxItem } from '@/lib/types';

/** InboxItem as returned by studio:replies:inbox (chunk D adds these fields on top of the core type). */
export type InboxRow = InboxItem & {
  platform?: string;
  accountUsername?: string | null;
  mediaType?: string | null;
  mediaProductType?: string | null;
  answered?: boolean;
  aiDisabled?: boolean;
};
