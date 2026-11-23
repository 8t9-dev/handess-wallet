/**
 * Domain Filters Component
 *
 * Filter panel for domain search and filtering.
 */

import { useDomains } from '../../hooks/useDomains';
import { Filter, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { NameState } from '../../types/domain';
import { extractDomainTags } from '../../lib/domain-tags';

const ALL_STATES: NameState[] = ['OPENING', 'BIDDING', 'REVEAL', 'CLOSED', 'TRANSFER', 'REVOKED'];

export function DomainFilters() {
  const { filters, setFilters, resetFilters, domains } = useDomains();
  const [isOpen, setIsOpen] = useState(false);

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    for (const domain of domains) {
      for (const tag of extractDomainTags(domain.dnsRecords)) tags.add(tag);
    }
    return [...tags].sort();
  }, [domains]);

  const activeFilterCount = [
    filters.searchText,
    filters.states.length > 0 ? 'states' : null,
    filters.expiryWithinBlocks ? 'expiry' : null,
    filters.tagNames.length > 0 ? 'tags' : null,
    filters.namePattern,
  ].filter(Boolean).length;

  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="flex gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="Search domains..."
            value={filters.searchText}
            onChange={(e) => setFilters({ searchText: e.target.value })}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
          />
          <Filter className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`px-4 py-2 border rounded-lg flex items-center gap-2 ${
            isOpen || activeFilterCount > 0
              ? 'border-hns-600 text-hns-600'
              : 'border-gray-300 dark:border-gray-600'
          }`}
        >
          <Filter className="w-4 h-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="px-1.5 py-0.5 bg-hns-600 text-white text-xs rounded-full">
              {activeFilterCount}
            </span>
          )}
        </button>
        {activeFilterCount > 0 && (
          <button
            onClick={() => resetFilters()}
            className="px-3 py-2 text-gray-500 hover:text-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Expanded filters */}
      {isOpen && (
        <div className="card space-y-4">
          {/* State filter */}
          <div>
            <label className="block text-sm font-medium mb-2">State</label>
            <div className="flex flex-wrap gap-2">
              {ALL_STATES.map((state) => (
                <button
                  key={state}
                  onClick={() => {
                    const newStates = filters.states.includes(state)
                      ? filters.states.filter((s) => s !== state)
                      : [...filters.states, state];
                    setFilters({ states: newStates });
                  }}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    filters.states.includes(state)
                      ? 'bg-hns-50 dark:bg-hns-900/30 border-hns-600 text-hns-700'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {state}
                </button>
              ))}
            </div>
          </div>

          {/* Expiry filter */}
          <div>
            <label className="block text-sm font-medium mb-2">Expiring Within</label>
            <select
              value={filters.expiryWithinBlocks || ''}
              onChange={(e) => setFilters({ expiryWithinBlocks: e.target.value ? parseInt(e.target.value) : null })}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
            >
              <option value="">Any</option>
              <option value="4320">30 days</option>
              <option value="8640">60 days</option>
              <option value="12960">90 days</option>
            </select>
          </div>

          {/* Tag filter */}
          {availableTags.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-2">TXT Tags</label>
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => {
                  const active = filters.tagNames.includes(tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => {
                        const next = active
                          ? filters.tagNames.filter((name) => name !== tag)
                          : [...filters.tagNames, tag];
                        setFilters({ tagNames: next });
                      }}
                      className={`px-3 py-1.5 text-sm rounded-full border ${
                        active
                          ? 'bg-hns-600 border-hns-600 text-white'
                          : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
