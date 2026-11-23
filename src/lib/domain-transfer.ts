import type { DomainWithMeta } from '../types/domain';

/** A transferred name is finalizable once its transfer lockup has elapsed. */
export function isTransferReadyToFinalize(
  domain: Pick<DomainWithMeta, 'transferring' | 'transferBlock'>,
  blockHeight: number | null,
  transferLockup: number,
): boolean {
  if (!domain.transferring || !domain.transferBlock || blockHeight == null) return false;
  return blockHeight - domain.transferBlock >= transferLockup;
}
