import { randomBytes, createHash } from 'crypto';
import { bech32 } from 'bech32';
import * as bitcoin from 'bitcoinjs-lib';
import * as tinysecp from 'tiny-secp256k1';
import { blake2b } from '@noble/hashes/blake2.js';
import { sha3_256 } from '@noble/hashes/sha3.js';

export type HnsNetwork = 'mainnet' | 'testnet' | 'regtest';

export interface HnsHtlcUtxo {
  txHash: string;
  vout: number;
  /** Value in dollarydoos. */
  value: number;
}

/** HNS HTLC claim/refund transaction fee in dollarydoos. */
export const HNS_HTLC_FEE = 50_000; // 0.05 HNS

export function generateSecret(): { secret: Buffer; secretHash: Buffer } {
  const secret = randomBytes(32);
  const secretHash = createHash('sha256').update(secret).digest();
  return { secret, secretHash };
}

function scriptNum(n: number): Buffer {
  if (n === 0) return Buffer.from([0x00]);
  const bytes: number[] = [];
  const neg = n < 0;
  let abs = Math.abs(n);
  while (abs > 0) { bytes.push(abs & 0xff); abs >>= 8; }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(neg ? 0x80 : 0x00);
  else if (neg) bytes[bytes.length - 1] |= 0x80;
  return Buffer.from(bytes);
}

function pushData(parts: Buffer[], data: Buffer): void {
  if (data.length < 0x4c) {
    parts.push(Buffer.from([data.length]));
  } else {
    parts.push(Buffer.from([0x4c, data.length & 0xff, (data.length >> 8) & 0xff]));
  }
  parts.push(data);
}

export function buildHnsHtlcScript(
  secretHash: Buffer,
  recipientPubKey: Buffer,
  refundPubKey: Buffer,
  timeoutBlock: number,
): Buffer {
  if (secretHash.length !== 32) throw new Error('HTLC secret hash must be 32 bytes');
  if (recipientPubKey.length !== 33) throw new Error('HTLC recipient key must be compressed');
  if (refundPubKey.length !== 33) throw new Error('HTLC refund key must be compressed');

  const parts: Buffer[] = [];
  parts.push(Buffer.from([0x63])); // OP_IF
  parts.push(Buffer.from([0xa8])); // OP_SHA256
  pushData(parts, secretHash);
  parts.push(Buffer.from([0x88])); // OP_EQUALVERIFY
  pushData(parts, recipientPubKey);
  parts.push(Buffer.from([0xac])); // OP_CHECKSIG
  parts.push(Buffer.from([0x67])); // OP_ELSE
  const td = scriptNum(timeoutBlock);
  parts.push(Buffer.from([td.length]));
  parts.push(td);
  parts.push(Buffer.from([0xb1])); // OP_CHECKLOCKTIMEVERIFY
  parts.push(Buffer.from([0x75])); // OP_DROP
  pushData(parts, refundPubKey);
  parts.push(Buffer.from([0xac])); // OP_CHECKSIG
  parts.push(Buffer.from([0x68])); // OP_ENDIF
  return Buffer.concat(parts);
}

/** HNS P2WSH scriptPubKey: OP_0 <SHA3-256(redeemScript)>. */
export function hnsP2wshScriptPubKey(redeemScript: Buffer): Buffer {
  const scriptHash = Buffer.from(sha3_256(redeemScript));
  return Buffer.concat([Buffer.from([0x00, 0x20]), scriptHash]);
}

function hnsHrp(network: HnsNetwork): string {
  if (network === 'testnet') return 'ts';
  if (network === 'regtest') return 'rs';
  return 'hs';
}

export function createHnsP2wshAddress(
  redeemScript: Buffer,
  network: HnsNetwork,
): string {
  const scriptHash = Buffer.from(sha3_256(redeemScript));
  return bech32.encode(hnsHrp(network), [0, ...bech32.toWords(scriptHash)]);
}

/**
 * Convert an HNS witness address into its output script. HNS uses its own
 * BLAKE2b/SHA3 hash rules, so we use the witness program encoded in the
 * address instead of bitcoinjs address helpers.
 */
export function hnsAddressToOutputScript(
  address: string,
  network: HnsNetwork,
): Buffer {
  const decoded = bech32.decode(address.trim(), 90);
  if (decoded.prefix !== hnsHrp(network)) {
    throw new Error(`Address is not an HNS ${network} address`);
  }
  const version = decoded.words[0];
  if (version !== 0) throw new Error('Only HNS witness v0 addresses are supported');
  const program = Buffer.from(bech32.fromWords(decoded.words.slice(1)));
  if (program.length !== 20 && program.length !== 32) {
    throw new Error('Invalid HNS witness program length');
  }
  return Buffer.concat([Buffer.from([0x00, program.length]), program]);
}

function uint32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

function uint64LE(value: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value), 0);
  return buf;
}

function varint(value: number): Buffer {
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

function varbytes(data: Buffer): Buffer {
  return Buffer.concat([varint(data.length), data]);
}

/**
 * HNS outputs serialize an address (version + hash) and an empty covenant,
 * not a Bitcoin-style scriptPubKey. Only witness outputs are created here.
 */
function hnsOutputBytes(script: Buffer, value: number | bigint): Buffer {
  const raw = Buffer.from(script);
  if (raw.length < 2 || raw[0] !== 0x00 || (raw[1] !== 20 && raw[1] !== 32)
    || raw.length !== 2 + raw[1]) {
    throw new Error('Unsupported HNS HTLC output script');
  }
  const hash = raw.subarray(2);
  return Buffer.concat([
    uint64LE(value),
    Buffer.from([0x00, hash.length]),
    hash,
    Buffer.from([0x00, 0x00]), // empty covenant: type NONE, zero items
  ]);
}

/**
 * HNS transaction serialization. Unlike Bitcoin, HNS always appends the
 * witness stack for every input after the locktime and does not use the
 * marker/flag form. bitcoinjs Transaction.toHex() must not be used here.
 */
export function serializeHnsTransactionBase(tx: bitcoin.Transaction): string {
  const parts: Buffer[] = [uint32LE(tx.version)];
  parts.push(varint(tx.ins.length));
  for (const input of tx.ins) {
    parts.push(Buffer.from(input.hash));
    parts.push(uint32LE(input.index));
    parts.push(uint32LE(input.sequence));
  }
  parts.push(varint(tx.outs.length));
  for (const output of tx.outs) {
    parts.push(hnsOutputBytes(Buffer.from(output.script), output.value));
  }
  parts.push(uint32LE(tx.locktime));
  return Buffer.concat(parts).toString('hex');
}

export function serializeHnsTransaction(tx: bitcoin.Transaction): string {
  const parts: Buffer[] = [Buffer.from(serializeHnsTransactionBase(tx), 'hex')];
  for (const input of tx.ins) {
    const witness = input.witness || [];
    parts.push(varint(witness.length));
    for (const item of witness) {
      parts.push(varbytes(Buffer.from(item)));
    }
  }
  return Buffer.concat(parts).toString('hex');
}

/** HNS transaction ID: BLAKE2b-256 of the base (non-witness) serialization. */
export function hnsTransactionId(tx: bitcoin.Transaction): string {
  return Buffer.from(
    blake2b(Buffer.from(serializeHnsTransactionBase(tx), 'hex'), { dkLen: 32 }),
  ).toString('hex');
}

/**
 * HNS witness signature hash. HNS uses BLAKE2b-256 instead of Bitcoin's
 * double-SHA256 for the BIP143-style commitment. This matches hsd's
 * MTX.signatureHash implementation.
 */
export function hnsSignatureHash(
  tx: bitcoin.Transaction,
  inputIndex: number,
  prevScript: Buffer,
  value: number,
  hashType = 0x01,
): Buffer {
  const prevouts = Buffer.concat(tx.ins.map((input) => Buffer.concat([
    input.hash,
    uint32LE(input.index),
  ])));
  const sequences = Buffer.concat(tx.ins.map((input) => uint32LE(input.sequence)));
  const outputs = Buffer.concat(tx.outs.map((output) => (
    hnsOutputBytes(Buffer.from(output.script), output.value)
  )));

  const input = tx.ins[inputIndex];
  if (!input) throw new Error('Invalid HTLC input index');

  const preimage = Buffer.concat([
    uint32LE(tx.version),
    blake2b(prevouts, { dkLen: 32 }),
    blake2b(sequences, { dkLen: 32 }),
    input.hash,
    uint32LE(input.index),
    varbytes(prevScript),
    uint64LE(value),
    uint32LE(input.sequence),
    blake2b(outputs, { dkLen: 32 }),
    uint32LE(tx.locktime),
    uint32LE(hashType),
  ]);

  return Buffer.from(blake2b(preimage, { dkLen: 32 }));
}

function signatureWithType(hash: Buffer, privateKey: Uint8Array): Buffer {
  // hsd verifies libsecp256k1 compact 64-byte signatures (not Bitcoin DER)
  // in its Script interpreter. tiny-secp256k1 is the compatible signer.
  const compact = tinysecp.sign(hash, Buffer.from(privateKey));
  return Buffer.concat([Buffer.from(compact), Buffer.from([0x01])]);
}

export function buildHnsClaimTx(params: {
  utxo: HnsHtlcUtxo;
  redeemScript: Buffer;
  secret: Buffer;
  privateKey: Uint8Array;
  toAddress: string;
  fee: number;
  network: HnsNetwork;
}): { txHex: string } {
  const { utxo, redeemScript, secret, privateKey, toAddress, fee, network } = params;
  if (utxo.value <= fee) throw new Error('HTLC value does not cover the claim fee');

  const tx = new bitcoin.Transaction();
  // hsd's mempool policy sets MAX_TX_VERSION = 0. Version 2 transactions are
  // rejected as nonstandard ("reason=version"), so HNS claim/refund txs must
  // use version 0.
  tx.version = 0;
  tx.locktime = 0;
  // HNS outpoints serialize the txid in display order; do not reverse it the
  // way Bitcoin outpoints are serialized.
  tx.addInput(
    Buffer.from(utxo.txHash, 'hex'),
    utxo.vout,
    0xffffffff,
  );
  tx.addOutput(
    hnsAddressToOutputScript(toAddress, network),
    BigInt(utxo.value - fee),
  );

  const hash = hnsSignatureHash(tx, 0, redeemScript, utxo.value);
  const signature = signatureWithType(hash, privateKey);
  tx.ins[0].witness = [
    signature,
    secret,
    Buffer.from([0x01]),
    redeemScript,
  ];

  return { txHex: serializeHnsTransaction(tx) };
}

export function buildHnsRefundTx(params: {
  utxo: HnsHtlcUtxo;
  redeemScript: Buffer;
  privateKey: Uint8Array;
  toAddress: string;
  fee: number;
  locktime: number;
  network: HnsNetwork;
}): { txHex: string } {
  const { utxo, redeemScript, privateKey, toAddress, fee, locktime, network } = params;
  if (utxo.value <= fee) throw new Error('HTLC value does not cover the refund fee');

  const tx = new bitcoin.Transaction();
  // See buildHnsClaimTx: HNS policy only accepts transaction version 0 and
  // outpoints use the txid in display order.
  tx.version = 0;
  tx.locktime = locktime;
  tx.addInput(
    Buffer.from(utxo.txHash, 'hex'),
    utxo.vout,
    0xfffffffe,
  );
  tx.addOutput(
    hnsAddressToOutputScript(toAddress, network),
    BigInt(utxo.value - fee),
  );

  const hash = hnsSignatureHash(tx, 0, redeemScript, utxo.value);
  const signature = signatureWithType(hash, privateKey);
  tx.ins[0].witness = [
    signature,
    Buffer.alloc(0),
    redeemScript,
  ];

  return { txHex: serializeHnsTransaction(tx) };
}
