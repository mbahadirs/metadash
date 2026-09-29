import { Link } from 'react-router-dom';
import { useT } from '@/lib/i18n';
import { fmtNum, fmtPct, fmtDateTime, fmtRelative } from '@/lib/format';
import type { RecentPost } from '@/lib/types';
import { Delta, Avatar } from './ui';
import { PostThumb } from './PostThumb';
import { TypeBadge } from './TypeFilter';
import { AdMetricHeaders, AdMetricCells } from './AdMetricCells';

/** "Posted this week" table: each post against the account's 90-day average for the same type. */
export function RecentPostsTable({ rows, onOpen, showAccount = true, maxHeight = 420, adColumns = true }: { rows: RecentPost[]; onOpen: (id: string) => void; showAccount?: boolean; maxHeight?: number; adColumns?: boolean }) {
  const t = useT();
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="table">
        <thead><tr>
          <th></th>{showAccount && <th>{t('account')}</th>}<th>{t('date')}</th><th>{t('type')}</th><th>{t('caption')}</th>
          <th className="num" title={t('reach_vs_avg_hint')}>{t('reach')}</th><th className="num" title={t('impressions_note')}>{t('total_reach')}</th><th className="num">{t('views')}</th><th className="num" title={t('er')}>{t('er_short')}</th><th className="num">{t('saved')}</th><th className="num">{t('comments')}</th>{adColumns && <AdMetricHeaders scope="post" />}
        </tr></thead>
        <tbody>
          {rows.map((r) => { const young = Date.now() - r.postedAt < 24 * 3_600_000; const dim = young ? 'opacity-40' : ''; return (
            <tr key={r.mediaId} className="clickable" onClick={() => onOpen(r.mediaId)} title={young ? t('young_post', { h: Math.floor((Date.now() - r.postedAt) / 3_600_000) }) : undefined}>
              <td><PostThumb mediaId={r.mediaId} thumbnailPath={r.thumbnailPath} mediaType={r.mediaType} mediaProductType={r.mediaProductType} size={28} /></td>
              {showAccount && <td><Link to={`/account/${r.igId}`} className="flex items-center gap-2 no-underline text-ink-1 hover:text-accent" onClick={(e) => e.stopPropagation()}><Avatar username={r.username} url={r.profilePicUrl} color={r.accountColor} size={18} platform={r.platform} />@{r.username}</Link></td>}
              <td className="text-ink-2">{fmtDateTime(r.postedAt)}<span className="badge badge-muted ml-2">{fmtRelative(r.postedAt)}</span></td>
              <td><TypeBadge typeKey={r.typeKey} /></td>
              <td className="max-w-[260px] truncate" title={r.caption ?? ''}>{r.caption}</td>
              <td className="num"><div className="leading-tight">{fmtNum(r.reach)}<div className={`text-xs ${dim}`}><Delta value={r.vsReach} /></div></div></td>
              <td className="num"><div className="leading-tight">{fmtNum(r.totalReach)}<div className="text-xs text-ink-2">{r.paidReach ? `${t('paid')} ${fmtNum(r.paidReach)} · ${fmtPct(r.paidReachShare, 0)}` : t('organic')}</div></div></td>
              <td className="num">{fmtNum(r.views)}</td>
              <td className="num"><div className="leading-tight">{fmtPct(r.engagementRate, 2)}<div className={`text-xs ${dim}`}><Delta value={r.vsEr} /></div></div></td>
              <td className="num"><div className="leading-tight">{fmtNum(r.saved)}<div className={`text-xs ${dim}`}><Delta value={r.vsSaved} /></div></div></td>
              <td className="num">{fmtNum(r.comments)}</td>
              {adColumns && <AdMetricCells row={r} scope="post" />}
            </tr>
          ); })}
          {!rows.length && <tr><td colSpan={(showAccount ? 11 : 10) + (adColumns ? 13 : 0)} className="text-center text-ink-2" style={{ height: 64 }}>{t('no_posts')}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
