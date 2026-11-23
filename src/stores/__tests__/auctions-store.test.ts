import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useAuctionsStore } from '../auctions-store';

const OPENED = {
  name: 'xn--gg-6352aa',
  txid: '427faaad4a5ebe8eb2a9c5b9ac866ac72136f076f32afc38b90d0972bbfacb3d',
  height: 352795,
  time: 1792870492,
};

function makeApi(overrides: {
  getNameDetail?: (name: string) => Promise<unknown>;
  getOpenedNames?: () => Promise<unknown>;
  getOpenedHidden?: () => Promise<unknown>;
} = {}) {
  return {
    node: {
      getBlockHeight: vi.fn().mockResolvedValue(352797),
      getNameDetail: vi.fn(
        overrides.getNameDetail ??
          (async () => ({ openHeight: 352795, state: 'OPENING', highest: 0 })),
      ),
    },
    wallet: {
      getBids: vi.fn().mockResolvedValue([]),
      getAuctions: vi.fn().mockResolvedValue([]),
      getNames: vi.fn().mockResolvedValue([]),
      getOpenedNames: vi.fn(overrides.getOpenedNames ?? (async () => [OPENED])),
      importName: vi.fn().mockResolvedValue(undefined),
    },
    db: {
      getAllBidReceipts: vi.fn().mockResolvedValue({}),
      getOpenedHidden: vi.fn(overrides.getOpenedHidden ?? (async () => [])),
    },
  };
}

function resetStore() {
  useAuctionsStore.setState({
    unifiedAuctions: [],
    openedNames: [],
    openedHidden: [],
    justRevealed: [],
    justRedeemed: [],
    justRegistered: [],
    bidReceipts: {},
    isLoading: false,
    error: null,
  });
}

describe('fetchUnifiedAuctions — history-sourced opened names', () => {
  beforeEach(resetStore);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes a history-opened name in unifiedAuctions and openedNames', async () => {
    vi.stubGlobal('window', { api: makeApi() });

    await useAuctionsStore.getState().fetchUnifiedAuctions();

    const state = useAuctionsStore.getState();
    expect(state.error).toBeNull();
    expect(state.openedNames).toEqual([OPENED]);

    const auction = state.unifiedAuctions.find(a => a.name === OPENED.name);
    expect(auction).toBeDefined();
    expect(auction?.blockchainState).toBe('OPENING');
    expect(auction?.startHeight).toBe(352795);
    expect(auction?.blocksUntilNext).toBe(35);
  });

  it('falls back to the history OPEN height when the node has no name detail', async () => {
    vi.stubGlobal('window', {
      api: makeApi({
        getNameDetail: async () => {
          throw new Error('name not found');
        },
      }),
    });

    await useAuctionsStore.getState().fetchUnifiedAuctions();

    const state = useAuctionsStore.getState();
    // Regression: this path used `phase` before its declaration and threw,
    // blanking every auctions tab.
    expect(state.error).toBeNull();

    const auction = state.unifiedAuctions.find(a => a.name === OPENED.name);
    expect(auction).toBeDefined();
    expect(auction?.startHeight).toBe(352795);
    expect(auction?.blockchainState).toBe('OPENING');
    expect(auction?.blocksUntilNext).toBe(35);
  });

  it('keeps a pending (unconfirmed) open visible with a null height', async () => {
    vi.stubGlobal('window', {
      api: makeApi({
        getOpenedNames: async () => [
          { name: 'pending-name', txid: '', height: null, time: 1, pending: true },
        ],
        getNameDetail: async () => {
          throw new Error('not indexed yet');
        },
      }),
    });

    await useAuctionsStore.getState().fetchUnifiedAuctions();

    const state = useAuctionsStore.getState();
    expect(state.error).toBeNull();
    expect(state.openedNames[0].pending).toBe(true);

    const auction = state.unifiedAuctions.find(a => a.name === 'pending-name');
    expect(auction).toBeDefined();
    expect(auction?.startHeight).toBe(0);
    expect(auction?.blockchainState).toBe('OPENING');
  });

  it('keeps a pending open in OPENING when the node reports AVAILABLE', async () => {
    // hsd's name index does not move until the OPEN is mined, so a
    // just-broadcast open resolves to AVAILABLE with no height. That raw
    // state must not make the row look like a closed auction.
    vi.stubGlobal('window', {
      api: makeApi({
        getOpenedNames: async () => [
          { name: 'pending-name', txid: '', height: null, time: 1, pending: true },
        ],
        getNameDetail: async () => ({ state: 'AVAILABLE', openHeight: 0 }),
      }),
    });

    await useAuctionsStore.getState().fetchUnifiedAuctions();

    const state = useAuctionsStore.getState();
    expect(state.error).toBeNull();

    const auction = state.unifiedAuctions.find(a => a.name === 'pending-name');
    expect(auction).toBeDefined();
    expect(auction?.blockchainState).toBe('OPENING');
  });

  it('still exposes dismissed names so the Opened tab can filter them', async () => {
    vi.stubGlobal('window', {
      api: makeApi({ getOpenedHidden: async () => [OPENED.name] }),
    });

    await useAuctionsStore.getState().fetchUnifiedAuctions();

    const state = useAuctionsStore.getState();
    expect(state.openedHidden).toEqual([OPENED.name]);
    expect(state.openedNames.map(o => o.name)).toEqual([OPENED.name]);
  });
});
