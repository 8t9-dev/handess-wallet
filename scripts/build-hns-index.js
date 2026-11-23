#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Build a compact Handshake TLD search index from a local hsd chain database.
 *
 * This is an offline build tool, not part of the wallet runtime. Stop hsd
 * before running it so the chain database is not locked:
 *
 *   node scripts/build-hns-index.js --prefix E:\\.hsd --out resources/hns-index.ndjson.gz
 *
 * The output is a gzip-compressed NDJSON file:
 *   line 1: { type: "header", version, network, height, generatedAt }
 *   line 2+: { name, state, renewal, expiryBlock, recordTypes, ns, addresses,
 *              tags, txt, hasNS, hasDS, hasTXT, hasWebsite }
 *
 * Only registered names with at least one resource record are included, and
 * the output is capped (default 250k) so the seed stays small enough to bundle
 * and load in memory. Names are ranked so tagged/TXT names and names with
 * custom DNS (not the shared parking glue) win the limited slots. The full
 * namespace is still reachable through on-demand lookup and recent-block
 * refresh in the app.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

function parseArgs(argv) {
  const args = {
    prefix: process.env.HSD_PREFIX || path.join(require('os').homedir(), '.hsd'),
    network: process.env.HSD_NETWORK || 'main',
    out: 'resources/hns-index.ndjson.gz',
    checkpoints: true,
    limit: 250000,
    maxScan: 0,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };

    switch (arg) {
      case '--prefix': args.prefix = next(); break;
      case '--network': args.network = next(); break;
      case '--out': args.out = next(); break;
      case '--limit': args.limit = Number.parseInt(next(), 10); break;
      case '--max-scan': args.maxScan = Number.parseInt(next(), 10); break;
      case '--no-checkpoints': args.checkpoints = false; break;
      case '--help':
        console.log(
          'Usage: node scripts/build-hns-index.js [--prefix PATH] [--network main] [--out FILE] [--limit N] [--max-scan N]',
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error('--limit must be a positive integer.');
  }
  if (!Number.isFinite(args.maxScan) || args.maxScan < 0) {
    throw new Error('--max-scan must be zero (all) or a positive integer.');
  }

  return args;
}

function resolveHsdModule(name) {
  const root = process.env.HSD_MODULE_ROOT;
  if (root) {
    const relative = name.startsWith('hsd/') ? name.slice(4) : name;
    return require(path.join(root, relative));
  }
  return require(name);
}

function parseTags(resource) {
  const tags = new Set();
  for (const record of resource.records) {
    if (record.type !== 6) continue; // hsTypes.TXT
    for (const chunk of record.txt || []) {
      const value = String(chunk).trim();
      if (!/^tag\s*:/i.test(value)) continue;
      const payload = value.replace(/^tag\s*:/i, '');
      for (const part of payload.split(/[,\s]+/)) {
        const tag = part.trim().toLowerCase();
        if (/^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag)) tags.add(tag);
      }
    }
  }
  return [...tags].sort();
}

function summarizeResource(resource) {
  const recordTypes = new Set();
  const ns = new Set();
  const addresses = new Set();
  const txt = [];

  for (const record of resource.records) {
    const json = record.toJSON();
    recordTypes.add(json.type);

    if (json.type === 'NS' && json.ns) ns.add(json.ns);
    if ((json.type === 'GLUE4' || json.type === 'GLUE6') && json.ns) ns.add(json.ns);
    if (json.address) addresses.add(json.address);
    if (json.type === 'TXT') {
      for (const value of json.txt || []) {
        const text = String(value).trim();
        if (text && txt.length < 3) txt.push(text.length > 160 ? `${text.slice(0, 157)}...` : text);
      }
    }
  }

  const tags = parseTags(resource);
  const types = [...recordTypes].sort();
  const hasNS = types.includes('NS') || types.includes('GLUE4') || types.includes('GLUE6');
  const hasDS = types.includes('DS');
  const hasTXT = types.includes('TXT');
  const hasWebsite = hasNS || types.includes('SYNTH4') || types.includes('SYNTH6');

  return {
    recordTypes: types,
    ns: [...ns].slice(0, 6),
    addresses: [...addresses].slice(0, 6),
    tags,
    txt,
    hasNS,
    hasDS,
    hasTXT,
    hasWebsite,
  };
}

// Most of the namespace is parked behind this shared glue pair. Those names
// are still useful as a fallback, but real/custom DNS should win the cap.
const PARKED_ADDRESSES = new Set(['44.231.6.183', '54.214.136.246']);
const PARKED_NS_SUFFIXES = ['.shakestation'];

function isParked(summary) {
  const byAddress = summary.addresses.length > 0
    && summary.addresses.every((address) => PARKED_ADDRESSES.has(address));
  const byNs = summary.ns.length > 0
    && summary.ns.every((host) => {
      const normalized = host.toLowerCase().replace(/\.$/, '');
      return PARKED_NS_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
    });
  return byAddress || byNs;
}

function hasExternalNs(summary, name) {
  return summary.ns.some((host) => {
    const normalized = host.toLowerCase().replace(/\.$/, '');
    return normalized !== name && !normalized.endsWith(`.${name}`);
  });
}

function qualityScore(name, summary, renewal) {
  let score = 0;
  if (summary.tags.length > 0) score += 1_000_000;
  // Real/custom DNS is the most useful signal after explicit tags. TXT names
  // (mostly parked verification records) fill whatever room is left.
  if (!isParked(summary)) score += 100_000;
  if (summary.hasTXT) score += 10_000;
  if (hasExternalNs(summary, name)) score += 1_000;
  if (summary.hasDS) score += 100;
  score += Math.min(99, Math.floor((renewal || 0) / 5000));
  return score;
}

/** True when `a` should be evicted before `b`. The heap root is the worst. */
function worseThan(a, b) {
  if (a.score !== b.score) return a.score < b.score;
  // Same score: keep alphabetically earlier names for a deterministic seed.
  return a.record.name > b.record.name;
}

function heapPush(heap, item) {
  heap.push(item);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (!worseThan(heap[index], heap[parent])) break;
    [heap[index], heap[parent]] = [heap[parent], heap[index]];
    index = parent;
  }
}

function heapReplaceRoot(heap, item) {
  heap[0] = item;
  let index = 0;
  for (;;) {
    const left = index * 2 + 1;
    const right = left + 1;
    let worst = index;
    if (left < heap.length && worseThan(heap[left], heap[worst])) worst = left;
    if (right < heap.length && worseThan(heap[right], heap[worst])) worst = right;
    if (worst === index) break;
    [heap[index], heap[worst]] = [heap[worst], heap[index]];
    index = worst;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const prefix = path.resolve(args.prefix);
  const out = path.resolve(args.out);
  const networkName = args.network === 'main' ? 'main' : args.network;

  const Network = resolveHsdModule('hsd/lib/protocol/network');
  const Logger = require('blgr');
  const BlockStore = resolveHsdModule('hsd/lib/blockstore');
  const ChainDB = resolveHsdModule('hsd/lib/blockchain/chaindb');
  const NameState = resolveHsdModule('hsd/lib/covenants/namestate');
  const { Resource } = resolveHsdModule('hsd/lib/dns/resource');

  const network = Network.get(networkName);
  const logger = new Logger({ level: 'warning' });
  const blocks = BlockStore.create({
    network,
    logger,
    prefix,
    memory: false,
    cacheSize: 32 << 20,
  });

  const db = new ChainDB({
    network,
    logger,
    blocks,
    prefix,
    location: path.join(prefix, 'chain'),
    treePrefix: path.join(prefix, 'tree'),
    memory: false,
    // These must match the flags the chain was opened with, even though the
    // seed only reads name states.
    indexTX: true,
    indexAddress: true,
    checkpoints: args.checkpoints,
    prune: false,
    entryCache: 5000,
    cacheSize: 32 << 20,
    maxFiles: 64,
    chainMigrate: -1,
  });

  console.log(`[index] Opening ${prefix} (${networkName})...`);
  await db.open();
  const tip = await db.getTip();
  if (!tip) throw new Error('Chain database has no tip.');
  const height = tip.height;
  console.log(`[index] Chain height ${height}`);

  fs.mkdirSync(path.dirname(out), { recursive: true });

  const limit = Math.floor(args.limit);
  const maxScan = Math.floor(args.maxScan);
  const heap = [];
  let scanned = 0;
  let eligible = 0;
  let tagged = 0;
  let withTxt = 0;
  let nonParked = 0;
  let withExternalNs = 0;
  let withDs = 0;
  const startedAt = Date.now();
  const iter = db.txn.iterator();

  const reportProgress = () => {
    if (scanned % 250000 === 0) {
      process.stdout.write(
        `\r[index] scanned ${scanned.toLocaleString()} names, eligible ${eligible.toLocaleString()}, kept ${heap.length.toLocaleString()}`,
      );
    }
  };

  while (await iter.next()) {
    if (maxScan > 0 && scanned >= maxScan) break;
    scanned++;
    const { value } = iter;
    let ns;
    try {
      ns = NameState.decode(value);
    } catch {
      reportProgress();
      continue;
    }

    if (!ns || !ns.name || ns.data.length === 0) {
      reportProgress();
      continue;
    }

    // Resource data can survive expiry and revocation, but only current
    // registrations are useful for a live TLD directory.
    let state;
    try {
      if (!ns.registered || ns.isExpired(height, network)) continue;
      // NameState.state() returns a numeric enum; the index stores names.
      state = NameState.statesByVal?.[ns.state(height, network)];
      if (!state || (state !== 'CLOSED' && state !== 'TRANSFER' && state !== 'LOCKED')) continue;
    } catch {
      continue;
    }

    let resource;
    try {
      resource = Resource.decode(ns.data);
    } catch {
      continue;
    }

    if (!resource.records.length) continue;

    const summary = summarizeResource(resource);
    const name = ns.name.toString('ascii');
    if (!/^[a-z0-9._-]+$/.test(name)) continue;

    eligible++;
    if (summary.tags.length > 0) tagged++;
    if (summary.hasTXT) withTxt++;
    if (summary.hasDS) withDs++;
    if (!isParked(summary)) nonParked++;
    if (hasExternalNs(summary, name)) withExternalNs++;

    const renewal = ns.renewal || 0;
    const expiryBlock = renewal ? renewal + network.names.renewalWindow : null;
    const candidate = {
      score: qualityScore(name, summary, renewal),
      record: {
        name,
        state,
        renewal: renewal || null,
        expiryBlock,
        ...summary,
      },
    };

    if (heap.length < limit) heapPush(heap, candidate);
    else if (worseThan(heap[0], candidate)) heapReplaceRoot(heap, candidate);

    reportProgress();
  }

  const selected = heap
    .map((item) => item.record)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const tagCounts = new Map();
  let selectedParked = 0;
  for (const record of selected) {
    if (isParked(record)) selectedParked++;
    for (const tag of record.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
  }

  const header = {
    type: 'header',
    version: 1,
    network: networkName,
    height,
    generatedAt: new Date().toISOString(),
  };

  async function* generate() {
    yield `${JSON.stringify(header)}\n`;
    for (const record of selected) {
      yield `${JSON.stringify(record)}\n`;
    }
  }

  await pipeline(
    Readable.from(generate(), { objectMode: false }),
    zlib.createGzip({ level: 9 }),
    fs.createWriteStream(out),
  );

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const size = fs.statSync(out).size;
  console.log(`\n[index] Done in ${seconds}s`);
  console.log(`[index] Scanned ${scanned.toLocaleString()} names; eligible ${eligible.toLocaleString()}`);
  console.log(
    `[index] Eligible: ${nonParked.toLocaleString()} non-parked, ${tagged.toLocaleString()} tagged, ` +
    `${withTxt.toLocaleString()} TXT, ${withDs.toLocaleString()} DS, ${withExternalNs.toLocaleString()} external NS`,
  );
  console.log(`[index] Kept ${selected.length.toLocaleString()} records (${selectedParked.toLocaleString()} parked fallback)`);
  console.log(`[index] Output ${out} (${(size / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`[index] Top tags: ${[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);

  await db.close();
}

main().catch((err) => {
  console.error('[index] Failed:', err);
  process.exitCode = 1;
});
