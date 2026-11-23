/**
 * Domains Hook
 *
 * Provides access to domain management state and actions.
 * Wraps the domains store with computed selectors.
 */

import { useMemo } from 'react';
import { useDomainsStore, getFilteredDomains } from '../stores/domains-store';

export function useDomains() {
  const store = useDomainsStore();

  // Compute filtered and sorted domains
  const filteredDomains = useMemo(
    () => getFilteredDomains(store.domains, store.filters, store.sort),
    [store.domains, store.filters, store.sort],
  );

  return {
    // Raw state
    domains: store.domains,
    filteredDomains,
    filters: store.filters,
    sort: store.sort,
    selectedNames: store.selectedNames,
    tags: store.tags,
    isLoading: store.isLoading,
    error: store.error,
    selectedCount: store.selectedNames.size,

    // Selection helpers
    isSelected: (name: string) => store.selectedNames.has(name),
    allSelected: store.selectedNames.size === store.domains.length,
    noneSelected: store.selectedNames.size === 0,

    // Actions
    fetchDomains: store.fetchDomains,
    setFilters: store.setFilters,
    resetFilters: store.resetFilters,
    setSort: store.setSort,
    toggleSelection: store.toggleSelection,
    selectAll: store.selectAll,
    deselectAll: store.deselectAll,
    assignTagToSelected: store.assignTagToSelected,
    removeTagFromSelected: store.removeTagFromSelected,
    createTag: store.createTag,
    deleteTag: store.deleteTag,
  };
}
