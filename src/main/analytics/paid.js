/** Normalises account-level ad totals (withDerived output) into the shared paid-metric field names used by every listing. */
export function paidFields(totals, account) {
  const t = totals ?? null;
  return {
    paidCurrency: account?.currency ?? null,
    monthlyBudget: account?.monthlyBudget ?? null,
    spend: t ? Math.round(t.spend * 100) / 100 : 0,
    paidImpressions: t?.impressions ?? 0,
    paidReach: t?.reach ?? 0,
    paidClicks: t?.clicks ?? 0,
    paidResults: t?.results ?? 0,
    paidResultType: t?.resultType ?? null,
    costPerResult: t?.costPerResult ?? null,
    paidFrequency: t?.frequency ?? null,
    paidCpc: t?.cpc ?? null,
    paidCtr: t?.ctr ?? null,
    paidCpm: t?.cpm ?? null,
    paidPostEngagement: t?.postEngagement ?? 0,
    costPerPostEngagement: t?.costPerPostEngagement ?? null,
    paidPageEngagement: t?.pageEngagement ?? 0,
    costPerPageEngagement: t?.costPerPageEngagement ?? null,
  };
}
