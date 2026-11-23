import { describe, it, expect } from 'vitest';
import { parseCsvRows, parseTagCsv } from '../tag-csv';

describe('parseCsvRows', () => {
  it('handles quoted fields, escaped quotes, commas, and CRLF', () => {
    const rows = parseCsvRows('\uFEFFname,tags\r\n"xn--armstrong-3d95h","coffee, sale"\r\n');
    expect(rows).toEqual([
      ['name', 'tags'],
      ['xn--armstrong-3d95h', 'coffee, sale'],
    ]);
  });

  it('handles a quoted field containing a newline', () => {
    const rows = parseCsvRows('name,tags\n"example","line one\nline two"\n');
    expect(rows[1][1]).toBe('line one\nline two');
  });
});

describe('parseTagCsv', () => {
  it('parses name and tags columns', () => {
    const result = parseTagCsv('name,tags\nexample,"coffee, sale"\nsecond,"tag: food"\n');
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { line: 2, name: 'example', tags: ['coffee', 'sale'], invalidTags: [] },
      { line: 3, name: 'second', tags: ['food'], invalidTags: [] },
    ]);
  });

  it('accepts domain/tag header aliases', () => {
    const result = parseTagCsv('domain,tag\nExample,\n');
    expect(result.rows).toEqual([
      { line: 2, name: 'example', tags: [], invalidTags: [] },
    ]);
  });

  it('requires name and tags columns', () => {
    expect(parseTagCsv('name,state\nexample,CLOSED\n').errors[0]).toContain('Missing "tags"');
    expect(parseTagCsv('tags\nexample\n').errors[0]).toContain('Missing "name"');
  });

  it('reports invalid names and invalid tags with line numbers', () => {
    const result = parseTagCsv('name,tags\nbad name,coffee\nexample,<bad>\n');
    expect(result.errors).toEqual([
      'Line 2: "bad name" is not a valid TLD name.',
      'Line 3: example has invalid tag: "<bad>".',
    ]);
  });

  it('deduplicates names with the last row winning', () => {
    const result = parseTagCsv('name,tags\nexample,coffee\nexample,sale\n');
    expect(result.duplicates).toEqual(['example']);
    expect(result.rows).toEqual([
      { line: 3, name: 'example', tags: ['sale'], invalidTags: [] },
    ]);
  });

  it('normalizes unicode names to punycode', () => {
    const result = parseTagCsv('name,tags\narmstrong💙,coffee\n');
    expect(result.rows[0].name).toBe('xn--armstrong-3d95h');
  });

  it('accepts legacy export names with a [ unicode ] suffix', () => {
    const result = parseTagCsv('name,tags\nxn--armstrong-3d95h [ armstrong💙 ],coffee\n');
    expect(result.rows[0].name).toBe('xn--armstrong-3d95h');
  });
});
