/**
 * Export Hook
 *
 * Provides export functionality for domains and search results.
 */

import { useCallback } from 'react';
import { domainsToCSV, domainsToJSON, downloadFile } from '../lib/export-utils';
import { estimateBlockDate } from '../lib/name-utils';
import { useConnectionStore } from '../stores/connection-store';
import type { NetworkName } from '../lib/constants';
import type { DomainWithMeta } from '../types/domain';
import type { NameLookupResult } from '../types/search';

export function useExport() {
  const blockHeight = useConnectionStore((s) => s.blockHeight);
  const networkStr = useConnectionStore((s) => s.network || 'main');
  const network = (networkStr === 'testnet' || networkStr === 'regtest' ? networkStr : 'main') as NetworkName;

  const exportDomainsToCSV = useCallback((domains: DomainWithMeta[], filename?: string) => {
    // The domains store leaves expiryDate null; derive it from the current
    // block height so the CSV matches the "~N months" shown in the table.
    const exportDomains = domains.map((d) =>
      d.expiryDate || blockHeight <= 0
        ? d
        : { ...d, expiryDate: estimateBlockDate(d.expiryBlock, blockHeight, network) },
    );
    const csv = domainsToCSV(exportDomains);
    const name = filename || `my-domains-${new Date().toISOString().split('T')[0]}.csv`;
    // UTF-8 BOM so Excel renders emoji/IDNA names correctly.
    downloadFile(`\uFEFF${csv}`, name, 'text/csv');
  }, [blockHeight, network]);

  const exportDomainsToJSON = useCallback((domains: DomainWithMeta[], filename?: string) => {
    const json = domainsToJSON(domains);
    const name = filename || `domains-${new Date().toISOString().split('T')[0]}.json`;
    downloadFile(json, name, 'application/json');
  }, []);

  const exportSearchResultsToCSV = useCallback((results: NameLookupResult[], filename?: string) => {
    // TODO: Implement using searchResultsToCSV
    const csv = '';
    const name = filename || `search-results-${new Date().toISOString().split('T')[0]}.csv`;
    downloadFile(csv, name, 'text/csv');
  }, []);

  return {
    exportDomainsToCSV,
    exportDomainsToJSON,
    exportSearchResultsToCSV,
  };
}
