/**
 * Non-custodial HNS escrow primitives.
 *
 * HNS is intentionally different from Bitcoin in the parts that matter here:
 * - P2WSH uses SHA3-256, not SHA256.
 * - Witness signature hashes use BLAKE2b-256.
 * - Transactions have no scriptSig and serialize witnesses after locktime.
 *
 * The three escrow keys are the buyer, seller, and an independent arbiter's
 * Nostr secp256k1 keys. The app never holds escrow keys for other parties and
 * never custodies funds.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as tinysecp from 'tiny-secp256k1';
import { MARKETPLACE_ESCROW_FEE_BUFFER } from '../../src/lib/marketplace-signing';
import {
  createHnsP2wshAddress,
  hnsAddressToOutputScript,
  hnsP2wshScriptPubKey,
  hnsSignatureHash,
  hnsTransactionId,
  serializeHnsTransaction,
  type HnsNetwork,
} from './htlc-hns-service';

export type EscrowNetwork = 'main' | 'testnet' | 'regtest';

/** Extra HNS added by the buyer to cover the release transaction fee. */
export const ESCROW_FEE_BUFFER = MARKETPLACE_ESCROW_FEE_BUFFER;

export interface EscrowUtxo {
  txHash: string;
  vout: number;
  /** Value in dollarydoos. */
  value: number;
  /** P2WSH output script. */
  script: Buffer;
  /** 2-of-3 redeem/witness script. */
  redeemScript: Buffer;
}

export interface EscrowPayout {
  address: string;
  /** Value in dollarydoos. */
  value: number;
}

export interface EscrowSignature {
  /** Compressed 33-byte pubkey hex. */
  pubkey: string;
  /** 64-byte compact ECDSA signature + SIGHASH_ALL byte. */
  signature: string;
}

/**
 * A portable escrow spend payload. The UI still calls this a PSBT because it
 * is the object exchanged between buyer, seller, and arbiter.
 */
export interface HnsEscrowPsbt {
  type: 'hns-escrow-psbt-v1';
  network: EscrowNetwork;
  input: {
    txHash: string;
    vout: number;
    value: number;
    redeemScript: string;
  };
  outputs: EscrowPayout[];
  signatures: EscrowSignature[];
}

function hnsNetworkName(network: EscrowNetwork): HnsNetwork {
  if (network === 'testnet') return 'testnet';
  if (network === 'regtest') return 'regtest';
  return 'mainnet';
}

/** Convert a 32-byte Nostr x-only public key to a compressed secp256k1 key. */
export function compressedNostrPubkey(nostrPubkey: string): Buffer {
  const hex = String(nostrPubkey || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error('Invalid Nostr public key');
  }
  try {
    // BIP340 keys are x-only and implicitly use the even-y point.
    return Buffer.from(secp256k1.Point.fromHex(`02${hex}`).toBytes(true));
  } catch {
    throw new Error('Invalid Nostr public key');
  }
}

/**
 * BIP340 uses the even-y point. Normalize a Nostr secret key so ECDSA
 * signatures verify against the 02-prefixed compressed public key.
 */
export function normalizeNostrSecretKey(secret: Uint8Array): Uint8Array {
  if (secret.length !== 32) throw new Error('Invalid Nostr secret key');

  const compressed = secp256k1.getPublicKey(secret, true);
  if (compressed[0] === 0x02) return secret;

  const order = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
  const scalar = BigInt(`0x${Buffer.from(secret).toString('hex')}`);
  const normalized = (order - scalar) % order;
  return Buffer.from(normalized.toString(16).padStart(64, '0'), 'hex');
}

export function buildEscrowRedeemScript(
  buyerPubkey: string,
  sellerPubkey: string,
  arbiterPubkey: string,
): Buffer {
  const buyer = compressedNostrPubkey(buyerPubkey);
  const seller = compressedNostrPubkey(sellerPubkey);
  const arbiter = compressedNostrPubkey(arbiterPubkey);
  if (new Set([buyer.toString('hex'), seller.toString('hex'), arbiter.toString('hex')]).size !== 3) {
    throw new Error('Escrow participants must use three distinct keys');
  }

  return Buffer.from(bitcoin.script.compile([
    bitcoin.opcodes.OP_2,
    buyer,
    seller,
    arbiter,
    bitcoin.opcodes.OP_3,
    bitcoin.opcodes.OP_CHECKMULTISIG,
  ]));
}

export function escrowOutputScript(redeemScript: Buffer): Buffer {
  return hnsP2wshScriptPubKey(redeemScript);
}

export function escrowAddress(
  redeemScript: Buffer,
  network: EscrowNetwork,
): string {
  return createHnsP2wshAddress(redeemScript, hnsNetworkName(network));
}

export function createEscrowUtxo(
  txHash: string,
  vout: number,
  value: number,
  redeemScript: Buffer,
): EscrowUtxo {
  return {
    txHash,
    vout,
    value,
    script: escrowOutputScript(redeemScript),
    redeemScript,
  };
}

export function serializeEscrowPsbt(data: HnsEscrowPsbt): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64');
}

export function parseEscrowPsbt(psbtBase64: string): HnsEscrowPsbt {
  let data: HnsEscrowPsbt;
  try {
    data = JSON.parse(Buffer.from(psbtBase64, 'base64').toString('utf8')) as HnsEscrowPsbt;
  } catch {
    throw new Error('Could not parse the escrow PSBT');
  }
  if (!data || data.type !== 'hns-escrow-psbt-v1') {
    throw new Error('Unsupported escrow PSBT format');
  }
  if (data.network !== 'main' && data.network !== 'testnet' && data.network !== 'regtest') {
    throw new Error('Unsupported escrow network');
  }
  if (!Array.isArray(data.outputs) || data.outputs.length === 0) {
    throw new Error('Escrow PSBT has no outputs');
  }
  if (!Array.isArray(data.signatures)) data.signatures = [];
  return data;
}

function buildUnsignedEscrowTx(data: HnsEscrowPsbt): bitcoin.Transaction {
  const tx = new bitcoin.Transaction();
  // HNS mempool policy only accepts transaction version 0.
  tx.version = 0;
  tx.locktime = 0;
  // HNS outpoints serialize the txid in display order; do not reverse it the
  // way Bitcoin outpoints are serialized.
  tx.addInput(
    Buffer.from(data.input.txHash, 'hex'),
    data.input.vout,
    0xffffffff,
  );
  for (const output of data.outputs) {
    tx.addOutput(
      hnsAddressToOutputScript(output.address, hnsNetworkName(data.network)),
      BigInt(output.value),
    );
  }
  return tx;
}

export function buildEscrowSpendPsbtMulti(
  utxo: EscrowUtxo,
  outputs: EscrowPayout[],
  network: EscrowNetwork,
): string {
  if (outputs.length === 0) {
    throw new Error('Escrow payout requires at least one output');
  }

  let total = 0;
  for (const output of outputs) {
    if (!Number.isSafeInteger(output.value) || output.value <= 0) {
      throw new Error('Invalid escrow payout amount');
    }
    total += output.value;
    if (!Number.isSafeInteger(total)) {
      throw new Error('Invalid escrow payout amount');
    }
  }
  if (total >= utxo.value) {
    throw new Error('Escrow payout must leave a transaction fee');
  }

  const data: HnsEscrowPsbt = {
    type: 'hns-escrow-psbt-v1',
    network,
    input: {
      txHash: utxo.txHash,
      vout: utxo.vout,
      value: utxo.value,
      redeemScript: utxo.redeemScript.toString('hex'),
    },
    outputs,
    signatures: [],
  };
  return serializeEscrowPsbt(data);
}

export function buildEscrowSpendPsbt(
  utxo: EscrowUtxo,
  recipient: string,
  outputValue: number,
  network: EscrowNetwork,
): string {
  return buildEscrowSpendPsbtMulti(
    utxo,
    [{ address: recipient, value: outputValue }],
    network,
  );
}

export function signEscrowPsbt(
  psbtBase64: string,
  nostrSecretKey: Uint8Array,
  nostrPubkey: string,
  network: EscrowNetwork,
): string {
  const data = parseEscrowPsbt(psbtBase64);
  if (data.network !== network) throw new Error('Escrow PSBT network mismatch');

  const normalized = normalizeNostrSecretKey(nostrSecretKey);
  const publicKey = compressedNostrPubkey(nostrPubkey);
  const redeemScript = Buffer.from(data.input.redeemScript, 'hex');
  const chunks = bitcoin.script.decompile(redeemScript);
  if (!Array.isArray(chunks)) throw new Error('Invalid escrow redeem script');
  const scriptKeys = chunks.filter((chunk): chunk is Buffer => Buffer.isBuffer(chunk))
    .map(chunk => chunk.toString('hex'));
  if (!scriptKeys.includes(publicKey.toString('hex'))) {
    throw new Error('The supplied key is not part of this escrow');
  }

  const tx = buildUnsignedEscrowTx(data);
  const hash = hnsSignatureHash(tx, 0, redeemScript, data.input.value);
  const signature = Buffer.concat([
    Buffer.from(tinysecp.sign(hash, Buffer.from(normalized))),
    Buffer.from([0x01]),
  ]).toString('hex');

  data.signatures = data.signatures.filter(
    entry => entry.pubkey !== publicKey.toString('hex'),
  );
  data.signatures.push({
    pubkey: publicKey.toString('hex'),
    signature,
  });
  return serializeEscrowPsbt(data);
}

export function finalizeEscrowPsbt(
  psbtBase64: string,
  network: EscrowNetwork,
): { txHex: string; txId: string } {
  const data = parseEscrowPsbt(psbtBase64);
  if (data.network !== network) throw new Error('Escrow PSBT network mismatch');
  if (data.signatures.length < 2) {
    throw new Error('At least two escrow signatures are required');
  }

  const redeemScript = Buffer.from(data.input.redeemScript, 'hex');
  const chunks = bitcoin.script.decompile(redeemScript);
  if (!Array.isArray(chunks) || chunks.length !== 6) {
    throw new Error('Invalid escrow redeem script');
  }
  const pubkeys = chunks.slice(1, 4)
    .filter((chunk): chunk is Buffer => Buffer.isBuffer(chunk))
    .map(chunk => chunk.toString('hex'));
  if (pubkeys.length !== 3) throw new Error('Invalid escrow redeem script keys');

  const ordered = pubkeys
    .map(pubkey => data.signatures.find(entry => entry.pubkey === pubkey))
    .filter((entry): entry is EscrowSignature => Boolean(entry));
  if (ordered.length < 2) {
    throw new Error('The escrow signatures do not match the redeem script');
  }

  const tx = buildUnsignedEscrowTx(data);
  tx.ins[0].witness = [
    Buffer.alloc(0),
    Buffer.from(ordered[0].signature, 'hex'),
    Buffer.from(ordered[1].signature, 'hex'),
    redeemScript,
  ];

  return {
    txHex: serializeHnsTransaction(tx),
    txId: hnsTransactionId(tx),
  };
}
