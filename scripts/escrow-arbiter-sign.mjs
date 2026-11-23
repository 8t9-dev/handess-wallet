#!/usr/bin/env node
/**
 * Offline signer for Handshake marketplace 2-of-3 escrow spends.
 *
 * The payload is the app's HNS escrow PSBT format: base64-encoded JSON with
 * the unsigned spend details and existing participant signatures. HNS uses
 * SHA3 P2WSH, BLAKE2b signature hashing, compact ECDSA signatures, and a
 * witness-after-locktime serialization, so this tool does not use Bitcoin
 * PSBT signing or serialization.
 *
 * Usage:
 *   ESCROW_ARBITER_NSEC=nsec1... node scripts/escrow-arbiter-sign.mjs trade.psbt
 *   ESCROW_ARBITER_NSEC=nsec1... node scripts/escrow-arbiter-sign.mjs \
 *     --network main --expect-recipient hs1... --expect-amount 100000000 trade.psbt
 *
 * The signed payload is written to stdout. Diagnostics go to stderr.
 * The secret is read only from the environment, never from argv.
 */

import { readFileSync } from 'node:fs';
import {
  Transaction,
  opcodes as OP,
  script,
} from 'bitcoinjs-lib';
import { bech32 } from 'bech32';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { blake2b } from '@noble/hashes/blake2.js';
import * as tinysecp from 'tiny-secp256k1';
import { nip19 } from 'nostr-tools';

const NETWORKS = {
  main: { hrp: 'hs' },
  testnet: { hrp: 'ts' },
  regtest: { hrp: 'rs' },
};

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    network: 'main',
    expectRecipient: null,
    expectAmount: null,
    expectFeeRecipient: null,
    expectFeeAmount: null,
    file: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--network') options.network = argv[++i];
    else if (arg === '--expect-recipient') options.expectRecipient = argv[++i];
    else if (arg === '--expect-amount') options.expectAmount = argv[++i];
    else if (arg === '--expect-fee-recipient') options.expectFeeRecipient = argv[++i];
    else if (arg === '--expect-fee-amount') options.expectFeeAmount = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      process.stderr.write(
        'usage: ESCROW_ARBITER_NSEC=nsec1... node scripts/escrow-arbiter-sign.mjs '
        + '[--network main|testnet|regtest] [--expect-recipient hs1...] '
        + '[--expect-amount dollarydoos] [--expect-fee-recipient hs1...] '
        + '[--expect-fee-amount dollarydoos] [psbt-file]\n',
      );
      process.exit(0);
    } else if (arg.startsWith('--')) fail(`unknown option: ${arg}`);
    else if (!options.file) options.file = arg;
    else fail('only one payload file can be signed at a time');
  }

  if (!NETWORKS[options.network]) fail(`unknown network: ${options.network}`);
  return options;
}

function readSecret() {
  const raw = process.env.ESCROW_ARBITER_NSEC || process.env.ESCROW_ARBITER_SECRET;
  if (!raw) {
    fail('set ESCROW_ARBITER_NSEC (nsec1...) or ESCROW_ARBITER_SECRET (64 hex characters)');
  }
  if (raw.startsWith('nsec1')) {
    const decoded = nip19.decode(raw);
    if (decoded.type !== 'nsec') fail('ESCROW_ARBITER_NSEC is not an nsec key');
    return decoded.data;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  fail('the arbiter secret must be an nsec1... key or 64 hex characters');
}

function normalizeSecret(secret) {
  const compressed = tinysecp.pointFromScalar(secret, true);
  if (!compressed) fail('invalid arbiter secret');
  if (compressed[0] === 0x02) {
    return { secret, compressed: Buffer.from(compressed) };
  }
  const order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const scalar = BigInt(`0x${Buffer.from(secret).toString('hex')}`);
  const negated = (order - scalar) % order;
  const normalized = Buffer.from(negated.toString(16).padStart(64, '0'), 'hex');
  const normalizedPub = tinysecp.pointFromScalar(normalized, true);
  if (!normalizedPub) fail('invalid normalized arbiter key');
  return { secret: normalized, compressed: Buffer.from(normalizedPub) };
}

function readPayload(file) {
  const buffer = file ? readFileSync(file) : readFileSync(0);
  let raw;
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) raw = buffer.toString('utf16le');
  else raw = buffer.toString('utf8');
  const base64 = raw.replace(/^\uFEFF/, '').trim();
  if (!base64) fail('no payload supplied');
  let data;
  try {
    data = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
  } catch {
    fail('could not parse the escrow payload');
  }
  if (!data || data.type !== 'hns-escrow-psbt-v1') {
    fail('unsupported escrow payload format');
  }
  if (!NETWORKS[options.network]) fail(`unknown network: ${options.network}`);
  if (data.network !== options.network) {
    fail(`payload network ${data.network} does not match --network ${options.network}`);
  }
  return data;
}

function uint32LE(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

function uint64LE(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

function varint(value) {
  if (value < 0xfd) return Buffer.from([value]);
  if (value <= 0xffff) {
    const buf = Buffer.alloc(3);
    buf[0] = 0xfd;
    buf.writeUInt16LE(value, 1);
    return buf;
  }
  if (value <= 0xffffffff) {
    const buf = Buffer.alloc(5);
    buf[0] = 0xfe;
    buf.writeUInt32LE(value, 1);
    return buf;
  }
  const buf = Buffer.alloc(9);
  buf[0] = 0xff;
  buf.writeBigUInt64LE(BigInt(value), 1);
  return buf;
}

function varbytes(data) {
  return Buffer.concat([varint(data.length), data]);
}

function addressParts(address) {
  const decoded = bech32.decode(String(address).trim(), 90);
  if (decoded.prefix !== NETWORKS[options.network].hrp) {
    fail(`address ${address} is not a ${options.network} HNS address`);
  }
  if (decoded.words[0] !== 0) fail('only HNS witness v0 addresses are supported');
  const program = Buffer.from(bech32.fromWords(decoded.words.slice(1)));
  if (program.length !== 20 && program.length !== 32) {
    fail('invalid HNS witness program');
  }
  return { version: 0, program };
}

function outputScript(address) {
  const { program } = addressParts(address);
  return Buffer.concat([Buffer.from([0x00, program.length]), program]);
}

function hnsOutputBytes(address, value) {
  const { version, program } = addressParts(address);
  return Buffer.concat([
    uint64LE(value),
    Buffer.from([version, program.length]),
    program,
    Buffer.from([0x00, 0x00]), // empty covenant
  ]);
}

function signatureHash(tx, input, redeemScript, value) {
  const prevouts = Buffer.concat(tx.ins.map(item => Buffer.concat([
    Buffer.from(item.hash),
    uint32LE(item.index),
  ])));
  const sequences = Buffer.concat(tx.ins.map(item => uint32LE(item.sequence)));
  const outputs = Buffer.concat(tx.outs.map(output => (
    hnsOutputBytes(output.address, output.value)
  )));
  const preimage = Buffer.concat([
    uint32LE(tx.version),
    blake2b(prevouts, { dkLen: 32 }),
    blake2b(sequences, { dkLen: 32 }),
    Buffer.from(input.hash),
    uint32LE(input.index),
    varbytes(redeemScript),
    uint64LE(value),
    uint32LE(input.sequence),
    blake2b(outputs, { dkLen: 32 }),
    uint32LE(tx.locktime),
    uint32LE(0x01),
  ]);
  return Buffer.from(blake2b(preimage, { dkLen: 32 }));
}

const options = parseArgs(process.argv.slice(2));
const secret = readSecret();
const { secret: signingKey, compressed } = normalizeSecret(secret);
const arbiterXOnly = compressed.subarray(1).toString('hex');
const payload = readPayload(options.file);
const redeemScript = Buffer.from(payload.input.redeemScript, 'hex');
const chunks = script.decompile(redeemScript);
if (!Array.isArray(chunks) || chunks.length !== 6
  || chunks[0] !== OP.OP_2
  || chunks[4] !== OP.OP_3
  || chunks[5] !== OP.OP_CHECKMULTISIG) {
  fail('the escrow witness script is not a 2-of-3 multisig script');
}
const keys = chunks.slice(1, 4).map(chunk => Buffer.from(chunk));
if (keys.some(key => key.length !== 33)) fail('invalid escrow public key');
if (new Set(keys.map(key => key.toString('hex'))).size !== 3) fail('duplicate escrow key');
if (!keys.some(key => key.equals(compressed))) {
  fail('the supplied key is not one of the three escrow participants');
}
if (!Array.isArray(payload.outputs) || payload.outputs.length === 0
  || payload.outputs.length > 2) {
  fail('escrow payload must contain one or two outputs');
}
for (const output of payload.outputs) {
  addressParts(output.address);
  if (!Number.isSafeInteger(output.value) || output.value <= 0) {
    fail('invalid escrow output amount');
  }
}
const totalOut = payload.outputs.reduce((sum, output) => sum + output.value, 0);
if (totalOut >= payload.input.value) {
  fail('escrow payout must leave a transaction fee');
}

const tx = new Transaction();
tx.version = 2;
tx.locktime = 0;
tx.addInput(
  Buffer.from(payload.input.txHash, 'hex').reverse(),
  payload.input.vout,
  0xffffffff,
);
const outputMap = [];
for (const output of payload.outputs) {
  const outScript = outputScript(output.address);
  tx.addOutput(outScript, BigInt(output.value));
  outputMap.push({ address: output.address, value: BigInt(output.value) });
}
// Attach address metadata to the transaction outputs for the hash routine.
tx.outs.forEach((out, index) => { out.address = outputMap[index].address; });

const hash = signatureHash(tx, tx.ins[0], redeemScript, payload.input.value);
const signature = Buffer.concat([
  Buffer.from(tinysecp.sign(hash, signingKey)),
  Buffer.from([0x01]),
]).toString('hex');

payload.signatures = (payload.signatures || []).filter(
  entry => entry.pubkey !== compressed.toString('hex'),
);
payload.signatures.push({
  pubkey: compressed.toString('hex'),
  signature,
});

process.stderr.write(`network: ${options.network}\n`);
process.stderr.write(`arbiter: ${arbiterXOnly}\n`);
process.stderr.write(`input: ${payload.input.txHash}:${payload.input.vout}\n`);
for (const [index, output] of payload.outputs.entries()) {
  process.stderr.write(
    `payout[${index}]: ${output.address} ${output.value} dollarydoos\n`,
  );
}
process.stderr.write(`fee: ${payload.input.value - totalOut} dollarydoos\n`);

const principal = payload.outputs[0];
if (options.expectRecipient && principal.address !== options.expectRecipient) {
  fail('principal payout address does not match --expect-recipient');
}
if (options.expectAmount) {
  let expected;
  try { expected = BigInt(options.expectAmount); } catch { fail('--expect-amount must be an integer'); }
  if (BigInt(principal.value) !== expected) fail('principal amount does not match --expect-amount');
}
if (options.expectFeeRecipient || options.expectFeeAmount) {
  if (payload.outputs.length < 2) fail('the payload has no separate fee output');
  let expectedFee = null;
  if (options.expectFeeAmount) {
    try { expectedFee = BigInt(options.expectFeeAmount); } catch { fail('--expect-fee-amount must be an integer'); }
  }
  const feeOutput = payload.outputs.find(output => (
    (!options.expectFeeRecipient || output.address === options.expectFeeRecipient)
    && (expectedFee === null || BigInt(output.value) === expectedFee)
  ));
  if (!feeOutput) fail('fee output does not match the expected recipient or amount');
}

process.stdout.write(`${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}\n`);
