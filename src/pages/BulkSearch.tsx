/**
 * Bulk Search Page
 *
 * Allows users to paste/upload lists of names to check availability,
 * then take bulk action on available names.
 *
 * TODO: Implementation:
 * 1. Input area with paste + file upload
 * 2. Parse and validate names
 * 3. Execute bulk lookup
 * 4. Display results table
 * 5. Allow bulk actions from results
 * 6. Save to search history
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConnectionStore } from '../stores/connection-store';
import { BulkSearchInput } from '../components/search/BulkSearchInput';
import { SearchResults } from '../components/search/SearchResults';
import { toPunycode } from '../lib/name-utils';
import type { NameLookupResult } from '../types/search';

export function BulkSearch() {
  const { connectionState } = useConnectionStore();
  const [results, setResults] = useState<NameLookupResult[]>([]);
  const [nameMap, setNameMap] = useState<Map<string, string>>(new Map());
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (names: string[]) => {
    setIsSearching(true);
    setHasSearched(true);
    setError(null);
    try {
      const punycodeNames = names.map(n => toPunycode(n));
      // Build punycode → original name map for display
      const map = new Map<string, string>();
      names.forEach((orig, i) => {
        if (punycodeNames[i] !== orig) map.set(punycodeNames[i], orig);
      });
      setNameMap(map);
      const searchResult = await window.api.node.bulkLookup(punycodeNames);
      setResults(searchResult.results);
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : 'Bulk lookup failed.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleClear = () => {
    setResults([]);
    setNameMap(new Map());
    setHasSearched(false);
  };

  if (connectionState !== 'connected') {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <div className="w-16 h-16 mb-4 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold mb-2">Not Connected</h2>
        <p className="text-gray-500 dark:text-gray-400 mb-4">
          Connect to your Handshake node to search for names.
        </p>
        <Link
          to="/settings"
          className="px-4 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 transition-colors"
        >
          Go to Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Bulk Search</h1>
        <p className="text-gray-500 dark:text-gray-400">
          Check availability for multiple names at once
        </p>
      </div>

      <BulkSearchInput onSearch={handleSearch} isSearching={isSearching} />

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {hasSearched && !error && (
        <SearchResults
          results={results}
          nameMap={nameMap}
          isLoading={isSearching}
          onClear={handleClear}
          onUpdateResultStatus={(name, status) => {
            setResults(prev => prev.map(r => r.name === name ? { ...r, status } : r));
          }}
        />
      )}
    </div>
  );
}
