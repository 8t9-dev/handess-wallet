/**
 * CSV parsing for bulk tag edits.
 *
 * The file must contain a name column (`name`, `domain`, or `tld`) and a tag
 * column (`tags` or `tag`). All other columns are ignored, so the CSV exported
 * from My Domains can be edited and imported directly.
 */

import { MAX_NAME_LENGTH, VALID_NAME_REGEX } from './constants';
import { MAX_TAGS_PER_NAME, normalizeTag } from './hns-index';
import { parseTagList } from './domain-tags';
import { toPunycode } from './name-utils';

export interface TagCsvRow {
  /** 1-based line number in the original file (including the header). */
  line: number;
  name: string;
  tags: string[];
  invalidTags: string[];
}

export interface TagCsvParseResult {
  rows: TagCsvRow[];
  /** File-level or row-level errors that prevent applying the row. */
  errors: string[];
  /** Names that appeared more than once (the last row wins). */
  duplicates: string[];
}

/** Parse RFC-4180-style CSV, including quoted fields and CRLF. */
export function parseCsvRows(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }

    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function normalizeName(value: string): string {
  let name = value.trim().toLowerCase().replace(/\.+$/, '');

  // Older exports used `punycode [ unicode ]`; accept them too.
  const displaySuffix = name.indexOf(' [');
  if (displaySuffix > 0) name = name.slice(0, displaySuffix).trim();

  try {
    name = toPunycode(name).toLowerCase().replace(/\.+$/, '');
  } catch {
    // Keep the raw value so validation reports it.
  }
  return name;
}

export function parseTagCsv(text: string): TagCsvParseResult {
  const errors: string[] = [];
  const duplicates: string[] = [];
  const rows = parseCsvRows(text);

  if (rows.length === 0) {
    return { rows: [], errors: ['The CSV file is empty.'], duplicates };
  }

  const header = rows[0].map((value) => value.trim().toLowerCase());
  const nameIndex = header.findIndex((value) => ['name', 'domain', 'tld'].includes(value));
  const tagsIndex = header.findIndex((value) => ['tags', 'tag'].includes(value));

  if (nameIndex === -1) {
    errors.push('Missing "name" column. Expected a header named name, domain, or tld.');
  }
  if (tagsIndex === -1) {
    errors.push('Missing "tags" column. Expected a header named tags or tag.');
  }
  if (errors.length > 0) return { rows: [], errors, duplicates };

  const byName = new Map<string, TagCsvRow>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const line = i + 1;
    const rawName = row[nameIndex] || '';
    const name = normalizeName(rawName);
    if (!name) continue;

    if (name.length > MAX_NAME_LENGTH || !VALID_NAME_REGEX.test(name)) {
      errors.push(`Line ${line}: "${rawName.trim()}" is not a valid TLD name.`);
      continue;
    }

    const parsed = parseTagList(row[tagsIndex] || '');
    if (parsed.tags.length > MAX_TAGS_PER_NAME) {
      errors.push(`Line ${line}: ${name} has more than ${MAX_TAGS_PER_NAME} tags.`);
      continue;
    }

    if (parsed.invalid.length > 0) {
      errors.push(
        `Line ${line}: ${name} has invalid tag${parsed.invalid.length > 1 ? 's' : ''}: ` +
        parsed.invalid.map((tag) => `"${tag}"`).join(', ') + '.',
      );
      continue;
    }

    const entry: TagCsvRow = {
      line,
      name,
      tags: parsed.tags.map((tag) => normalizeTag(tag) || tag).filter(Boolean),
      invalidTags: [],
    };

    if (byName.has(name)) duplicates.push(name);
    byName.set(name, entry);
  }

  if (byName.size === 0 && errors.length === 0) {
    errors.push('No names were found in the CSV file.');
  }

  return { rows: [...byName.values()], errors, duplicates };
}
