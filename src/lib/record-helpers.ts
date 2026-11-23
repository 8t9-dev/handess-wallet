import type { DNSRecord, DNSRecordType } from '../types/domain';

export function getEmptyRecord(type: DNSRecordType): DNSRecord {
  switch (type) {
    case 'NS': return { type: 'NS', ns: '' };
    case 'GLUE4': return { type: 'GLUE4', ns: '', address: '' };
    case 'GLUE6': return { type: 'GLUE6', ns: '', address: '' };
    case 'DS': return { type: 'DS', keyTag: 0, algorithm: 0, digestType: 0, digest: '' };
    case 'TXT': return { type: 'TXT', txt: [] };
    case 'SYNTH4': return { type: 'SYNTH4', address: '' };
    case 'SYNTH6': return { type: 'SYNTH6', address: '' };
  }
}

function isValidIPv4(s: string): boolean {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = Number(p);
    return n >= 0 && n <= 255 && String(n) === p;
  });
}

function isValidIPv6(s: string): boolean {
  try {
    const bytes = s.split(':');
    if (bytes.length < 2 || bytes.length > 8) return false;
    return bytes.every(b => b === '' || /^[0-9a-fA-F]{1,4}$/.test(b));
  } catch {
    return false;
  }
}

export interface ValidationError {
  field: string;
  message: string;
}

export function validateRecord(record: DNSRecord): ValidationError[] {
  const errors: ValidationError[] = [];
  switch (record.type) {
    case 'NS':
      if (!record.ns) errors.push({ field: 'ns', message: 'Nameserver hostname is required' });
      break;
    case 'GLUE4':
      if (!record.ns) errors.push({ field: 'ns', message: 'Nameserver hostname is required' });
      else if (!isValidIPv4(record.address)) errors.push({ field: 'address', message: 'Invalid IPv4 address' });
      break;
    case 'GLUE6':
      if (!record.ns) errors.push({ field: 'ns', message: 'Nameserver hostname is required' });
      else if (!isValidIPv6(record.address)) errors.push({ field: 'address', message: 'Invalid IPv6 address' });
      break;
    case 'DS':
      if (record.keyTag < 0 || record.keyTag > 65535) errors.push({ field: 'keyTag', message: 'Key tag must be 0-65535' });
      if (record.algorithm < 0 || record.algorithm > 255) errors.push({ field: 'algorithm', message: 'Algorithm must be 0-255' });
      if (record.digestType < 0 || record.digestType > 255) errors.push({ field: 'digestType', message: 'Digest type must be 0-255' });
      if (!record.digest) errors.push({ field: 'digest', message: 'Digest is required' });
      else if (!/^[0-9a-f]+$/i.test(record.digest)) errors.push({ field: 'digest', message: 'Digest must be hex' });
      break;
    case 'TXT':
      if (!record.txt.length || !record.txt[0]) errors.push({ field: 'txt', message: 'Text value is required' });
      break;
    case 'SYNTH4':
      if (!isValidIPv4(record.address)) errors.push({ field: 'address', message: 'Invalid IPv4 address' });
      break;
    case 'SYNTH6':
      if (!isValidIPv6(record.address)) errors.push({ field: 'address', message: 'Invalid IPv6 address' });
      break;
  }
  return errors;
}

export function serializeRecord(record: DNSRecord): string {
  switch (record.type) {
    case 'NS': return record.ns;
    case 'TXT': return record.txt[0] || '';
    case 'DS': return `${record.keyTag} ${record.algorithm} ${record.digestType} ${record.digest}`;
    case 'GLUE4': return `${record.ns} ${record.address}`;
    case 'GLUE6': return `${record.ns} ${record.address}`;
    case 'SYNTH4': return record.address;
    case 'SYNTH6': return record.address;
  }
}

/** Human-readable value for the read-only explorer resource table. */
export function formatResourceRecord(record: DNSRecord): string {
  switch (record.type) {
    case 'NS':
      return record.ns;
    case 'GLUE4':
    case 'GLUE6':
      return `${record.ns} → ${record.address}`;
    case 'DS':
      return `keyTag=${record.keyTag} · algorithm=${record.algorithm} · digestType=${record.digestType} · ${record.digest}`;
    case 'TXT':
      return record.txt.map((value) => `"${value}"`).join(' ');
    case 'SYNTH4':
    case 'SYNTH6':
      return record.address;
  }
}

export function deserializeRecord(type: DNSRecordType, value: string): DNSRecord {
  switch (type) {
    case 'NS': return { type: 'NS', ns: value.trim() };
    case 'TXT': return { type: 'TXT', txt: [value] };
    case 'DS': {
      const parts = value.trim().split(/\s+/);
      return {
        type: 'DS',
        keyTag: parseInt(parts[0]) || 0,
        algorithm: parseInt(parts[1]) || 0,
        digestType: parseInt(parts[2]) || 0,
        digest: parts.slice(3).join('') || '',
      };
    }
    case 'GLUE4': {
      const idx = value.trim().lastIndexOf(' ');
      return {
        type: 'GLUE4',
        ns: idx > 0 ? value.trim().slice(0, idx) : value.trim(),
        address: idx > 0 ? value.trim().slice(idx + 1) : '',
      };
    }
    case 'GLUE6': {
      const idx = value.trim().lastIndexOf(' ');
      return {
        type: 'GLUE6',
        ns: idx > 0 ? value.trim().slice(0, idx) : value.trim(),
        address: idx > 0 ? value.trim().slice(idx + 1) : '',
      };
    }
    case 'SYNTH4': return { type: 'SYNTH4', address: value.trim() };
    case 'SYNTH6': return { type: 'SYNTH6', address: value.trim() };
  }
}
