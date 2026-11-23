/**
 * Export utility functions.
 *
 * Converts domain data to CSV and JSON formats for download.
 * Used by the ExportButton component and useExport hook.
 */

import type { DomainWithMeta } from '../types/domain';
import type { NameLookupResult } from '../types/search';
import { dollaryDoosToHNS } from './name-utils';
import { extractDomainTags, formatTags } from './domain-tags';

// ============================================================
// CSV Export
// ============================================================

/**
 * Convert an array of domain objects to CSV string.
 *
 * Names are exported as raw punycode so the file can be edited and re-imported.
 * The decoded IDNA/emoji form remains visible in the UI.
 *
 * @param domains - Array of domain data to export
 * @param columns - Which columns to include (default: all)
 * @returns CSV string with headers
 */
export function domainsToCSV(
  domains: DomainWithMeta[],
  columns?: string[],
): string {
  // Default columns. `dnsRecordCount` is intentionally omitted; use the
  // `dnsRecordCount` column explicitly if you need it.
  const defaultColumns = [
    'name',
    'state',
    'expiryBlock',
    'expiryDate',
    'renewalBlock',
    'value',
    'tags',
  ];

  const cols = columns || defaultColumns;
  const headers = cols.join(',');

  const rows = domains.map((domain) => {
    return cols
      .map((col) => {
        // TODO: Map each column to its value, properly escape CSV values
        switch (col) {
          case 'name':
            // Raw punycode so the CSV can be edited and re-imported.
            return escapeCSV(domain.name);
          case 'state':
            return escapeCSV(domain.state);
          case 'expiryBlock':
            return String(domain.expiryBlock);
          case 'expiryDate':
            return domain.expiryDate ? escapeCSV(domain.expiryDate.toISOString()) : '';
          case 'renewalBlock':
            return String(domain.renewalBlock);
          case 'value':
            return String(dollaryDoosToHNS(domain.value));
          case 'tags':
            return escapeCSV(formatTags(extractDomainTags(domain.dnsRecords)));
          case 'dnsRecordCount':
            return String(domain.dnsRecords.length);
          default:
            return '';
        }
      })
      .join(',');
  });

  return [headers, ...rows].join('\n');
}

/**
 * Convert bulk search results to CSV string.
 *
 * @param results - Array of name lookup results
 * @returns CSV string with headers
 */
export function searchResultsToCSV(results: NameLookupResult[]): string {
  const headers = 'name,status,owner,expiryBlock,expiryDate,highestBid,value';

  const rows = results.map((r) =>
    [
      escapeCSV(r.name),
      escapeCSV(r.status),
      escapeCSV(r.owner || ''),
      r.expiryBlock != null ? String(r.expiryBlock) : '',
      r.expiryDate ? escapeCSV(r.expiryDate.toISOString()) : '',
      r.highestBid != null ? String(dollaryDoosToHNS(r.highestBid)) : '',
      r.value != null ? String(dollaryDoosToHNS(r.value)) : '',
    ].join(','),
  );

  return [headers, ...rows].join('\n');
}

/**
 * One row of the multi-sign CSV export.
 * The message is the exact message that was signed, repeated per name.
 */
export interface MessageSignatureRow {
  name: string;
  message: string;
  signature: string;
}

/**
 * Convert signed messages to CSV.
 *
 * Header: `name,message,signature`
 *
 * The message is written verbatim (not trimmed) so the CSV can be used to
 * verify the signature. Only successful signatures should be passed here.
 */
export function signaturesToCSV(rows: MessageSignatureRow[]): string {
  const headers = 'name,message,signature';

  const lines = rows.map((row) =>
    [
      escapeCSV(row.name),
      escapeCSV(row.message),
      escapeCSV(row.signature),
    ].join(','),
  );

  return [headers, ...lines].join('\n');
}

// ============================================================
// JSON Export
// ============================================================

/**
 * Convert domains to a JSON export format.
 *
 * @param domains - Array of domain data to export
 * @returns JSON string (pretty-printed)
 */
export function domainsToJSON(domains: DomainWithMeta[]): string {
  const exportData = domains.map((domain) => ({
    name: domain.name,
    state: domain.state,
    expiryBlock: domain.expiryBlock,
    expiryDate: domain.expiryDate?.toISOString() || null,
    renewalBlock: domain.renewalBlock,
    valueHNS: dollaryDoosToHNS(domain.value),
    tags: extractDomainTags(domain.dnsRecords),
    dnsRecordCount: domain.dnsRecords.length,
    dnsRecords: domain.dnsRecords,
    ownerHash: domain.ownerHash,
    transferring: domain.transferring,
    transferBlock: domain.transferBlock,
    revoked: domain.revoked,
  }));

  return JSON.stringify(exportData, null, 2);
}

/**
 * Convert search results to a JSON export format.
 *
 * @param results - Array of name lookup results
 * @returns JSON string (pretty-printed)
 */
export function searchResultsToJSON(results: NameLookupResult[]): string {
  return JSON.stringify(results, null, 2);
}

// ============================================================
// Import Parsing
// ============================================================

/**
 * Parse a text input (paste) into an array of name strings.
 * Handles newlines, commas, spaces, and tabs as delimiters.
 *
 * @param text - Raw text input from user
 * @returns Array of trimmed, non-empty strings
 */
export function parseTextInput(text: string): string[] {
  return text
    .split(/[\n,\t\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/\.$/, ''))
    .filter((s) => s.length > 0);
}

/**
 * Parse a CSV file content into an array of name strings.
 * Expects either a single column or a column with header "name".
 *
 * @param csvContent - Raw CSV file content
 * @returns Array of name strings
 *
 * TODO: Handle multi-column CSV with header detection
 */
export function parseCSVInput(csvContent: string): string[] {
  const lines = csvContent.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  // Check if first line is a header
  const firstLine = lines[0].toLowerCase();
  const startIndex = firstLine === 'name' || firstLine === 'domain' || firstLine === 'tld' ? 1 : 0;

  return lines
    .slice(startIndex)
    .map((line) => {
      // Take the first column (in case of multi-column CSV)
      const value = line.split(',')[0].trim().toLowerCase().replace(/"/g, '');
      return value;
    })
    .filter((s) => s.length > 0);
}

/**
 * Parse a JSON file content into an array of name strings.
 * Expects an array of strings: ["name1", "name2", ...]
 *
 * @param jsonContent - Raw JSON file content
 * @returns Array of name strings
 * @throws Error if JSON is not a string array
 */
export function parseJSONInput(jsonContent: string): string[] {
  const parsed = JSON.parse(jsonContent);

  if (!Array.isArray(parsed)) {
    throw new Error('JSON must be an array of strings');
  }

  return parsed
    .filter((item): item is string => typeof item === 'string')
    .map((s) => s.trim().toLowerCase());
}

// ============================================================
// Helpers
// ============================================================

/**
 * Escape a value for CSV output.
 * Wraps in quotes if the value contains commas, quotes, or newlines.
 */
function escapeCSV(value: string): string {
  if (
    value.includes(',') ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Trigger a file download in the renderer process.
 *
 * @param content - File content string
 * @param filename - Suggested filename
 * @param mimeType - MIME type (default: text/csv)
 *
 * TODO: Implement using Electron's dialog.showSaveDialog for proper native save dialog
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/csv'): void {
  // TODO: In Electron, use dialog.showSaveDialog() via IPC instead of this browser approach
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoking so Electron has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
