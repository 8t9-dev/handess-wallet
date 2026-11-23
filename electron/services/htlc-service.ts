import { randomBytes, createHash } from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { toBitcoinJsNetwork, getDgbNetwork } from '../dgb-networks';
import type { DgbNetworkType } from '../../src/types/swap';

export const HTLC_TIMEOUT_HNS = 288; // ~48 hours at 10-minute blocks
export const HTLC_TIMEOUT_DGB = 1440; // ~6 hours at 15-second blocks
export const DGB_DUST = 546;
const SIGHASH_ALL = 0x01;

export interface DgbFundingUtxo {
  txHash: string;
  vout: number;
  value: number;
}

export function generateSecret(): { secret: Buffer; secretHash: Buffer } {
  const secret = randomBytes(32);
  const secretHash = createHash('sha256').update(secret).digest();
  return { secret, secretHash };
}

function scriptNum(n: number): Buffer {
  if (n === 0) return Buffer.from([0x00]);
  const bytes: number[] = [];
  let abs = Math.abs(n);
  const neg = n < 0;
  while (abs > 0) { bytes.push(abs & 0xff); abs >>= 8; }
  if (bytes[bytes.length - 1] & 0x80) bytes.push(neg ? 0x80 : 0x00);
  else if (neg) bytes[bytes.length - 1] |= 0x80;
  return Buffer.from(bytes);
}

/**
 * DGB HTLC:
 * OP_IF <secretHash> OP_EQUALVERIFY <recipientKey> OP_CHECKSIG
 * OP_ELSE <timeout> OP_CHECKLOCKTIMEVERIFY OP_DROP <refundKey> OP_CHECKSIG
 * OP_ENDIF
 */
export function buildHtlcRedeemScript(
  secretHash: Buffer,
  recipientPubKey: Buffer,
  refundPubKey: Buffer,
  timeoutBlock: number,
): Buffer {
  if (secretHash.length !== 32) throw new Error('HTLC secret hash must be 32 bytes');
  if (recipientPubKey.length !== 33) throw new Error('HTLC recipient key must be compressed');
  if (refundPubKey.length !== 33) throw new Error('HTLC refund key must be compressed');

  return Buffer.from(bitcoin.script.compile([
    bitcoin.opcodes.OP_IF,
    bitcoin.opcodes.OP_SHA256,
    secretHash,
    bitcoin.opcodes.OP_EQUALVERIFY,
    recipientPubKey,
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ELSE,
    scriptNum(timeoutBlock),
    bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
    bitcoin.opcodes.OP_DROP,
    refundPubKey,
    bitcoin.opcodes.OP_CHECKSIG,
    bitcoin.opcodes.OP_ENDIF,
  ]));
}

export function createP2shAddress(
  redeemScript: Buffer,
  network: DgbNetworkType,
): { address: string; scriptHash: Buffer; outputScript: Buffer } {
  const net = toBitcoinJsNetwork(getDgbNetwork(network));
  const p2sh = bitcoin.payments.p2sh({
    redeem: { output: redeemScript },
    network: net,
  });
  if (!p2sh.address || !p2sh.hash || !p2sh.output) {
    throw new Error('Could not derive DGB P2SH address');
  }
  return {
    address: p2sh.address,
    scriptHash: Buffer.from(p2sh.hash),
    outputScript: Buffer.from(p2sh.output),
  };
}

function signatureWithType(hash: Uint8Array, privateKey: Uint8Array): Buffer {
  // `hash` is already the transaction sighash. Noble v2 prehashes by default,
  // which would sign SHA256(sighash) and be rejected by DigiByte nodes.
  const der = secp256k1.sign(hash, privateKey, { format: 'der', prehash: false });
  return Buffer.concat([Buffer.from(der), Buffer.from([SIGHASH_ALL])]);
}

function estimatedLegacySize(inputs: number, outputs: number): number {
  return 10 + inputs * 148 + outputs * 34;
}

/**
 * Build and sign a DGB funding transaction spending P2PKH wallet UTXOs into
 * the HTLC P2SH output. The HTLC amount is exact; the wallet pays the fee.
 */
export function buildDgbFundingTx(params: {
  utxos: DgbFundingUtxo[];
  privateKey: Uint8Array;
  changeAddress: string;
  htlcScript: Buffer;
  htlcAmount: number;
  feeRateSatPerKb: number;
  network: DgbNetworkType;
}): { txHex: string; txId: string; fee: number; change: number } {
  const {
    utxos, privateKey, changeAddress, htlcScript, htlcAmount, feeRateSatPerKb, network,
  } = params;
  if (utxos.length === 0) throw new Error('No DGB UTXOs available');
  if (!Number.isSafeInteger(htlcAmount) || htlcAmount <= 0) {
    throw new Error('Invalid DGB HTLC amount');
  }

  const net = toBitcoinJsNetwork(getDgbNetwork(network));
  const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, true));
  const prevScript = bitcoin.address.toOutputScript(changeAddress, net);
  const p2sh = bitcoin.payments.p2sh({ redeem: { output: htlcScript }, network: net });
  if (!p2sh.output) throw new Error('Could not derive DGB HTLC output script');

  const total = utxos.reduce((sum, utxo) => sum + utxo.value, 0);
  const sizeWithChange = estimatedLegacySize(utxos.length, 2);
  let fee = Math.max(1000, Math.ceil((feeRateSatPerKb * sizeWithChange) / 1000));
  let change = total - htlcAmount - fee;
  if (change < DGB_DUST) {
    const sizeWithoutChange = estimatedLegacySize(utxos.length, 1);
    fee = Math.max(1000, Math.ceil((feeRateSatPerKb * sizeWithoutChange) / 1000));
    change = total - htlcAmount - fee;
  }
  if (change < 0) throw new Error('Insufficient DGB funds for the HTLC and fee');

  const tx = new bitcoin.Transaction();
  tx.version = 2;
  for (const utxo of utxos) {
    tx.addInput(Buffer.from(utxo.txHash, 'hex').reverse(), utxo.vout, 0xffffffff);
  }
  tx.addOutput(Buffer.from(p2sh.output), BigInt(htlcAmount));
  if (change >= DGB_DUST) {
    tx.addOutput(bitcoin.address.toOutputScript(changeAddress, net), BigInt(change));
  }

  for (let i = 0; i < utxos.length; i += 1) {
    const hash = tx.hashForSignature(i, prevScript, SIGHASH_ALL);
    const signature = signatureWithType(hash, privateKey);
    tx.ins[i].script = bitcoin.script.compile([signature, publicKey]);
    tx.ins[i].witness = [];
  }

  return {
    txHex: tx.toHex(),
    txId: tx.getId(),
    fee: total - htlcAmount - (change >= DGB_DUST ? change : 0),
    change: change >= DGB_DUST ? change : 0,
  };
}

export function buildDgbClaimTx(params: {
  utxo: { txHash: string; vout: number; value: number };
  redeemScript: Buffer;
  secret: Buffer;
  privateKey: Uint8Array;
  toAddress: string;
  fee: number;
  network: DgbNetworkType;
}): { txHex: string; txId: string } {
  const { utxo, redeemScript, secret, privateKey, toAddress, fee, network } = params;
  if (utxo.value <= fee) throw new Error('HTLC value does not cover the DGB claim fee');

  const net = toBitcoinJsNetwork(getDgbNetwork(network));
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.addInput(Buffer.from(utxo.txHash, 'hex').reverse(), utxo.vout, 0xffffffff);
  tx.addOutput(
    bitcoin.address.toOutputScript(toAddress, net),
    BigInt(utxo.value - fee),
  );

  const hash = tx.hashForSignature(0, redeemScript, SIGHASH_ALL);
  const signature = signatureWithType(hash, privateKey);
  tx.ins[0].script = bitcoin.script.compile([
    signature,
    secret,
    bitcoin.opcodes.OP_1,
    redeemScript,
  ]);
  tx.ins[0].witness = [];

  return { txHex: tx.toHex(), txId: tx.getId() };
}

export function buildDgbRefundTx(params: {
  utxo: { txHash: string; vout: number; value: number };
  redeemScript: Buffer;
  privateKey: Uint8Array;
  toAddress: string;
  fee: number;
  locktime: number;
  network: DgbNetworkType;
}): { txHex: string; txId: string } {
  const { utxo, redeemScript, privateKey, toAddress, fee, locktime, network } = params;
  if (utxo.value <= fee) throw new Error('HTLC value does not cover the DGB refund fee');

  const net = toBitcoinJsNetwork(getDgbNetwork(network));
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = locktime;
  tx.addInput(Buffer.from(utxo.txHash, 'hex').reverse(), utxo.vout, 0xfffffffe);
  tx.addOutput(
    bitcoin.address.toOutputScript(toAddress, net),
    BigInt(utxo.value - fee),
  );

  const hash = tx.hashForSignature(0, redeemScript, SIGHASH_ALL);
  const signature = signatureWithType(hash, privateKey);
  tx.ins[0].script = bitcoin.script.compile([
    signature,
    bitcoin.opcodes.OP_0,
    redeemScript,
  ]);
  tx.ins[0].witness = [];

  return { txHex: tx.toHex(), txId: tx.getId() };
}
