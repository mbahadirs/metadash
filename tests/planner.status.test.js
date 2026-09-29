import { describe, it, expect } from 'vitest';
import {
  POST_STATUSES, TARGET_STATES, checkTransition, canTransition, applyContentEdit, derivePostStatus, contentHash, isApprovalCurrent,
} from '../src/main/planner/status.js';

describe('post status machine', () => {
  const allowed = [
    ['draft', 'in_review'], ['draft', 'scheduled'],
    ['in_review', 'approved'], ['in_review', 'changes_requested'], ['in_review', 'draft'],
    ['changes_requested', 'in_review'], ['changes_requested', 'draft'],
    ['approved', 'scheduled'], ['approved', 'draft'],
    ['scheduled', 'draft'],
    ['failed', 'scheduled'], ['partial', 'scheduled'],
    ['draft', 'archived'], ['published', 'archived'], ['failed', 'archived'], ['scheduled', 'archived'],
    ['archived', 'draft'],
  ];
  it.each(allowed)('%s → %s is allowed for the user', (from, to) => {
    expect(checkTransition(from, to, { actor: 'user' })).toEqual({ ok: true });
  });

  const rejected = [
    ['draft', 'approved'], ['draft', 'published'], ['in_review', 'scheduled'], ['approved', 'in_review'],
    ['published', 'draft'], ['publishing', 'archived'], ['scheduled', 'published'], ['archived', 'scheduled'],
  ];
  it.each(rejected)('%s → %s is rejected', (from, to) => {
    const res = checkTransition(from, to, { actor: 'user' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('transition_not_allowed');
  });

  it('draft → scheduled needs approval when requireApproval is on', () => {
    expect(checkTransition('draft', 'scheduled', { requireApproval: true })).toEqual({ ok: false, reason: 'approval_required' });
    expect(checkTransition('approved', 'scheduled', { requireApproval: true })).toEqual({ ok: true });
  });

  it('scheduled → publishing and publishing → outcome are worker/system only', () => {
    expect(checkTransition('scheduled', 'publishing', { actor: 'user' })).toEqual({ ok: false, reason: 'worker_only' });
    expect(checkTransition('scheduled', 'publishing', { actor: 'worker' })).toEqual({ ok: true });
    expect(checkTransition('publishing', 'published', { actor: 'worker' })).toEqual({ ok: true });
    expect(checkTransition('publishing', 'partial', { actor: 'system' })).toEqual({ ok: true });
    expect(checkTransition('publishing', 'failed', { actor: 'user' }).ok).toBe(false);
  });

  it('same status and unknown statuses', () => {
    expect(checkTransition('draft', 'draft')).toEqual({ ok: false, reason: 'same_status' });
    expect(checkTransition('draft', 'nope')).toEqual({ ok: false, reason: 'unknown_status' });
    expect(canTransition('draft', 'in_review')).toBe(true);
  });

  it('exports every status and target state', () => {
    expect(POST_STATUSES).toContain('changes_requested');
    expect(TARGET_STATES).toEqual(expect.arrayContaining(['idle', 'queued', 'handed_off', 'published', 'missed', 'paused']));
  });
});

describe('content edits and approval', () => {
  it('invalidates approval for approved/scheduled posts when approval is required', () => {
    expect(applyContentEdit({ status: 'approved', requireApproval: true })).toEqual({ status: 'in_review', invalidated: true });
    expect(applyContentEdit({ status: 'scheduled', requireApproval: true })).toEqual({ status: 'in_review', invalidated: true });
  });
  it('keeps the status otherwise', () => {
    expect(applyContentEdit({ status: 'approved', requireApproval: false })).toEqual({ status: 'approved', invalidated: false });
    expect(applyContentEdit({ status: 'draft', requireApproval: true })).toEqual({ status: 'draft', invalidated: false });
    expect(applyContentEdit({ status: 'in_review', requireApproval: true })).toEqual({ status: 'in_review', invalidated: false });
  });

  const base = {
    caption: 'Hello', firstComment: null,
    targets: [{ accountId: '1', format: 'image', captionOverride: null, firstCommentOverride: null, options: { a: 1, b: 2 } }],
    assets: [{ assetId: 5, role: 'media', position: 0, altText: null }],
  };
  it('content hash changes with caption, targets, assets, alt text; not with title/time', () => {
    const h = contentHash(base);
    expect(contentHash({ ...base, title: 'x', scheduledAt: 123 })).toBe(h);
    expect(contentHash({ ...base, caption: 'Hello!' })).not.toBe(h);
    expect(contentHash({ ...base, firstComment: '#tag' })).not.toBe(h);
    expect(contentHash({ ...base, targets: [{ ...base.targets[0], format: 'carousel' }] })).not.toBe(h);
    expect(contentHash({ ...base, assets: [{ ...base.assets[0], altText: 'dog' }] })).not.toBe(h);
  });
  it('content hash ignores option key order and target/asset order', () => {
    const h = contentHash(base);
    expect(contentHash({ ...base, targets: [{ ...base.targets[0], options: { b: 2, a: 1 } }] })).toBe(h);
    const two = { ...base, targets: [base.targets[0], { ...base.targets[0], accountId: '2' }] };
    expect(contentHash({ ...two, targets: [...two.targets].reverse() })).toBe(contentHash(two));
  });
  it('isApprovalCurrent compares approved_version with version', () => {
    expect(isApprovalCurrent({ version: 3, approvedVersion: 3 })).toBe(true);
    expect(isApprovalCurrent({ version: 4, approvedVersion: 3 })).toBe(false);
    expect(isApprovalCurrent({ version: 1, approvedVersion: null })).toBe(false);
  });
});

describe('derivePostStatus', () => {
  const t = (state) => ({ state });
  it.each([
    [[t('published'), t('published')], 'published'],
    [[t('published'), t('failed')], 'partial'],
    [[t('published'), t('missed')], 'partial'],
    [[t('failed'), t('failed')], 'failed'],
    [[t('failed'), t('missed')], 'failed'],
    [[t('published'), t('publishing')], null],
    [[t('queued'), t('failed')], null],
    [[t('published'), t('canceled')], 'published'],
    [[t('handed_off')], null],
    [[t('canceled')], null],
    [[], null],
  ])('%j → %s', (targets, expected) => {
    expect(derivePostStatus(targets)).toBe(expected);
  });
});
