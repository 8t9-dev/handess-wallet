/**
 * Bulk Search Input Component
 *
 * Input area for bulk name search with paste/upload functionality.
 */

import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { parseTextInput, parseCSVInput, parseJSONInput } from '../../lib/export-utils';
import type { ImportFormat } from '../../types/search';

interface BulkSearchInputProps {
  onSearch: (names: string[]) => void;
  isSearching: boolean;
}

export function BulkSearchInput({ onSearch, isSearching }: BulkSearchInputProps) {
  const [input, setInput] = useState('');
  const [format, setFormat] = useState<ImportFormat>('text');
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      let names: string[];

      if (file.name.endsWith('.json')) {
        names = parseJSONInput(content);
      } else {
        names = parseCSVInput(content);
      }

      setInput(names.join('\n'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
    }
  };

  const handleSubmit = () => {
    if (!input.trim()) {
      setError('Please enter some names');
      return;
    }

    try {
      let names: string[];
      if (format === 'json') {
        names = parseJSONInput(input);
      } else if (format === 'csv') {
        names = parseCSVInput(input);
      } else {
        names = parseTextInput(input);
      }

      if (names.length === 0) {
        setError('No valid names found');
        return;
      }

      if (names.length > 1000) {
        setError('Maximum 1000 names allowed');
        return;
      }

      setError(null);
      onSearch(names);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse input');
    }
  };

  return (
    <div className="card space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">Input Format</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              checked={format === 'text'}
              onChange={() => setFormat('text')}
            />
            Text (newline/comma separated)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              checked={format === 'csv'}
              onChange={() => setFormat('csv')}
            />
            CSV
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="format"
              checked={format === 'json'}
              onChange={() => setFormat('json')}
            />
            JSON
          </label>
        </div>
      </div>

      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            format === 'json'
              ? '["name1", "name2"]'
              : 'Enter names (one per line or comma-separated)'
          }
          className="w-full h-40 px-4 py-3 font-mono text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 resize-none"
        />
        {input && (
          <button
            onClick={() => setInput('')}
            className="absolute top-2 right-2 p-1 bg-gray-100 dark:bg-gray-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-500">
          <Upload className="w-4 h-4" />
          Upload file
          <input
            type="file"
            accept=".csv,.json,.txt"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        <button
          onClick={handleSubmit}
          disabled={isSearching || !input.trim()}
          className="px-6 py-2 bg-hns-600 text-white rounded-lg hover:bg-hns-700 disabled:opacity-50"
        >
          {isSearching ? 'Searching...' : 'Search Names'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
