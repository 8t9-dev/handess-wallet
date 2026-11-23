import { describe, expect, it } from 'vitest';
import { isTransferReadyToFinalize } from '../domain-transfer';

describe('isTransferReadyToFinalize', () => {
  it('is ready after the full transfer lockup', () => {
    expect(isTransferReadyToFinalize({ transferring: true, transferBlock: 100 }, 388, 288)).toBe(true);
    expect(isTransferReadyToFinalize({ transferring: true, transferBlock: 100 }, 387, 288)).toBe(false);
  });

  it('is not ready without an active transfer or a known height', () => {
    expect(isTransferReadyToFinalize({ transferring: false, transferBlock: 100 }, 500, 288)).toBe(false);
    expect(isTransferReadyToFinalize({ transferring: true, transferBlock: null }, 500, 288)).toBe(false);
    expect(isTransferReadyToFinalize({ transferring: true, transferBlock: 100 }, null, 288)).toBe(false);
  });
});
