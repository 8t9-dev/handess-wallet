/**
 * Domains Store (Zustand)
 *
 * Manages the domain list, filtering, sorting, selection, and tags.
 * This is the largest store -- it backs the MyDomains page.
 *
 * Features:
 * - Fetch and cache all wallet names
 * - Multi-column sorting
 * - Advanced filtering (text, regex, state, tags, expiry, name length)
 * - Multi-select for bulk operations
 * - Tag assignment
 */

import { create } from 'zustand';
import { getUnicodeName, getNameSortKey } from '../lib/name-utils';
import { NETWORKS } from '../lib/constants';
import { extractDomainTags } from '../lib/domain-tags';
import { useConnectionStore } from './connection-store';
import type {
  Domain,
  DomainWithMeta,
  DomainSort,
  DomainFilters,
  Tag,
} from '../types/domain';

interface DomainsStore {
  // State
  /** All domains from the wallet (raw, unfiltered) */
  domains: DomainWithMeta[];

  /** Currently applied filters */
  filters: DomainFilters;

  /** Current sort configuration */
  sort: DomainSort;

  /** Set of selected domain names (for bulk operations) */
  selectedNames: Set<string>;

  /** All available tags */
  tags: Tag[];

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: string | null;

  /** Last refresh timestamp */
  lastRefresh: Date | null;

  // Computed (implement as getters or selectors)
  // filteredDomains: DomainWithMeta[]  -- computed from domains + filters + sort

  // Actions
  /** Fetch all domains from the wallet via IPC */
  fetchDomains: () => Promise<void>;

  /** Update filter criteria */
  setFilters: (filters: Partial<DomainFilters>) => void;

  /** Reset filters to defaults */
  resetFilters: () => void;

  /** Update sort configuration */
  setSort: (sort: DomainSort) => void;

  /** Toggle selection of a single domain */
  toggleSelection: (name: string) => void;

  /** Select all currently filtered domains */
  selectAll: () => void;

  /** Deselect all */
  deselectAll: () => void;

  /** Select domains matching a filter predicate */
  selectByFilter: (predicate: (domain: DomainWithMeta) => boolean) => void;

  /** Fetch tags from database */
  fetchTags: () => Promise<void>;

  /** Assign a tag to selected domains */
  assignTagToSelected: (tagId: number) => Promise<void>;

  /** Remove a tag from selected domains */
  removeTagFromSelected: (tagId: number) => Promise<void>;

  /** Create a new tag */
  createTag: (name: string, color: string) => Promise<Tag>;

  /** Delete a tag */
  deleteTag: (id: number) => Promise<void>;
}

export const useDomainsStore = create<DomainsStore>((set, get) => ({
  // Initial state
  domains: [],
  filters: {
    searchText: '',
    namePattern: null,
    states: [],
    tagIds: [],
    tagNames: [],
    expiryWithinBlocks: null,
    nameLengthMin: null,
    nameLengthMax: null,
    untaggedOnly: false,
  },
  sort: { field: 'name', direction: 'asc' },
  selectedNames: new Set(),
  tags: [],
  isLoading: false,
  error: null,
  lastRefresh: null,

  fetchDomains: async () => {
    set({ isLoading: true, error: null });
    try {
      const rawDomains = await window.api.wallet.getNames(true);
      const tags = await window.api.db.getTags();
      const network = useConnectionStore.getState().network || 'main';
      const renewalWindow = NETWORKS[network].renewalWindow;

      const enrichedDomains: DomainWithMeta[] = rawDomains.map((d: Domain) => {
        const renewalBlock = d.renewalBlock || 0;
        const expiryBlock = renewalBlock + renewalWindow;
        return {
          ...d,
          expiryBlock,
          expiryDate: null,
          expiryUrgency: 'safe',
          tags: [],
          notes: '',
          selected: false,
        };
      });

      set({ domains: enrichedDomains, tags, isLoading: false, lastRefresh: new Date() });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch domains',
      });
    }
  },

  setFilters: (newFilters) => {
    set((state) => ({
      filters: { ...state.filters, ...newFilters },
    }));
  },

  resetFilters: () => {
    set({
      filters: {
        searchText: '',
        namePattern: null,
        states: [],
        tagIds: [],
        tagNames: [],
        expiryWithinBlocks: null,
        nameLengthMin: null,
        nameLengthMax: null,
        untaggedOnly: false,
      },
    });
  },

  setSort: (sort) => {
    set({ sort });
  },

  toggleSelection: (name) => {
    set((state) => {
      const newSelected = new Set(state.selectedNames);
      if (newSelected.has(name)) {
        newSelected.delete(name);
      } else {
        newSelected.add(name);
      }
      return { selectedNames: newSelected };
    });
  },

  selectAll: () => {
    const { domains, filters, sort } = get();
    const filtered = getFilteredDomains(domains, filters, sort);
    set({ selectedNames: new Set(filtered.map(d => d.name)) });
  },

  deselectAll: () => {
    set({ selectedNames: new Set() });
  },

  selectByFilter: (predicate) => {
    const names = get().domains.filter(predicate).map((d) => d.name);
    set({ selectedNames: new Set(names) });
  },

  fetchTags: async () => {
    const tags = await window.api.db.getTags();
    set({ tags });
  },

  assignTagToSelected: async (tagId) => {
    for (const name of get().selectedNames) {
      await window.api.db.assignTag(name, tagId);
    }
    await get().fetchDomains();
  },

  removeTagFromSelected: async (tagId) => {
    for (const name of get().selectedNames) {
      await window.api.db.removeTag(name, tagId);
    }
    await get().fetchDomains();
  },

  createTag: async (name, color) => {
    const tag = await window.api.db.createTag(name, color);
    await get().fetchTags();
    return tag;
  },

  deleteTag: async (id) => {
    await window.api.db.deleteTag(id);
    await get().fetchTags();
  },
}));

// ============================================================
// Selectors (pure functions for derived state)
// ============================================================

/**
 * Get filtered and sorted domains.
 * Call this in components: const filtered = getFilteredDomains(store);
 *
 * TODO: Implement filtering logic:
 * 1. Text search: name.includes(searchText)
 * 2. Regex: new RegExp(namePattern).test(name)
 * 3. State filter: states.includes(domain.state)
 * 4. Tag filter: domain.tags.some(t => tagIds.includes(t.id))
 * 5. Expiry filter: domain.expiryBlock <= currentBlock + expiryWithinBlocks
 * 6. Name length: name.length >= min && name.length <= max
 * 7. Untagged: domain.tags.length === 0
 *
 * Then sort by sort.field + sort.direction
 */
export function getFilteredDomains(
  domains: DomainWithMeta[],
  filters: DomainFilters,
  sort: DomainSort,
): DomainWithMeta[] {
  let result = [...domains];

  // TODO: Apply filters
  const searchText = filters.searchText.trim().toLowerCase();
  if (searchText) {
    // Match punycode as well as the decoded IDNA/emoji form, so searching
    // `armstrong💙` finds `xn--armstrong-3d95h`.
    result = result.filter((d) => {
      if (d.name.toLowerCase().includes(searchText)) return true;
      const unicodeName = getUnicodeName(d.name);
      return unicodeName ? unicodeName.toLowerCase().includes(searchText) : false;
    });
  }

  if (filters.states.length > 0) {
    result = result.filter((d) => filters.states.includes(d.state));
  }

  if (filters.namePattern) {
    try {
      const pattern = new RegExp(filters.namePattern, 'i');
      result = result.filter((d) => pattern.test(d.name));
    } catch {
      // Ignore an invalid user-entered regex.
    }
  }

  if (filters.tagNames.length > 0) {
    result = result.filter((d) => {
      const tags = extractDomainTags(d.dnsRecords);
      return filters.tagNames.every((tag) => tags.includes(tag));
    });
  }

  if (filters.untaggedOnly) {
    result = result.filter((d) => extractDomainTags(d.dnsRecords).length === 0);
  }

  if (filters.expiryWithinBlocks != null) {
    const currentBlock = useConnectionStore.getState().blockHeight;
    if (currentBlock > 0) {
      const limit = currentBlock + filters.expiryWithinBlocks;
      result = result.filter((d) => d.expiryBlock > 0 && d.expiryBlock <= limit);
    }
  }

  if (filters.nameLengthMin != null || filters.nameLengthMax != null) {
    const min = filters.nameLengthMin ?? 0;
    const max = filters.nameLengthMax ?? Number.MAX_SAFE_INTEGER;
    result = result.filter((d) => d.name.length >= min && d.name.length <= max);
  }

  // TODO: Apply sorting
  // Precompute decoded sort keys once — decoding inside the comparator
  // would run tens of thousands of times per keystroke.
  const nameSortKeys = sort.field === 'name'
    ? new Map(result.map((d) => [d.name, getNameSortKey(d.name)]))
    : null;

  result.sort((a, b) => {
    let cmp = 0;
    switch (sort.field) {
      case 'name': {
        // Sort by the decoded name when one exists (see getNameSortKey).
        const aKey = nameSortKeys?.get(a.name) ?? a.name;
        const bKey = nameSortKeys?.get(b.name) ?? b.name;
        cmp = aKey.localeCompare(bKey) || a.name.localeCompare(b.name);
        break;
      }
      case 'expiryBlock':
        cmp = a.expiryBlock - b.expiryBlock;
        break;
      case 'state':
        cmp = a.state.localeCompare(b.state);
        break;
      case 'nameLength':
        cmp = a.name.length - b.name.length;
        break;
      default:
        cmp = 0;
    }
    return sort.direction === 'asc' ? cmp : -cmp;
  });

  return result;
}
