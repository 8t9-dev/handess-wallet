import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { createRequire } from 'node:module';
import { bech32 } from 'bech32';
import * as bitcoin from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  buildHnsClaimTx,
  buildHnsHtlcScript,
  buildHnsRefundTx,
  createHnsP2wshAddress,
  hnsAddressToOutputScript,
  hnsP2wshScriptPubKey,
  hnsSignatureHash,
  hnsTransactionId,
  serializeHnsTransaction,
  HNS_HTLC_FEE,
} from '../htlc-hns-service';
import {
  compressedNostrPubkey,
  normalizeNostrSecretKey,
} from '../hns-escrow-service';

process.env.NODE_BACKEND = 'js';
const require = createRequire(import.meta.url);
const MTX = require('hsd/lib/primitives/tx');
const Script = require('hsd/lib/script/script');
const Address = require('hsd/lib/primitives/address');

const recipientSecret = normalizeNostrSecretKey(new Uint8Array(32).fill(7));
const recipientPub = compressedNostrPubkey(
  Buffer.from(secp256k1.getPublicKey(recipientSecret, true)).subarray(1).toString('hex'),
);
const refundSecret = normalizeNostrSecretKey(new Uint8Array(32).fill(8));
const refundPub = compressedNostrPubkey(
  Buffer.from(secp256k1.getPublicKey(refundSecret, true)).subarray(1).toString('hex'),
);
const secret = Buffer.alloc(32, 9);
const secretHash = createHash('sha256').update(secret).digest();
const timeout = 1_000;
const redeemScript = buildHnsHtlcScript(secretHash, recipientPub, refundPub, timeout);
const htlcAddress = createHnsP2wshAddress(redeemScript, 'mainnet');

function p2wpkhAddress(seed: number): string {
  const program = Buffer.alloc(20, seed);
  return bech32.encode('hs', [0, ...bech32.toWords(program)]);
}

const utxo = {
  txHash: '11'.repeat(32),
  vout: 1,
  value: 200_000_000,
};

describe('HNS HTLC primitives', () => {
  it('derives the correct SHA3 P2WSH script and address', () => {
    const expectedScript = Buffer.concat([
      Buffer.from([0x00, 0x20]),
      Buffer.from(sha3_256(redeemScript)),
    ]);
    expect(hnsP2wshScriptPubKey(redeemScript).toString('hex'))
      .toBe(expectedScript.toString('hex'));
    const hsdAddress = Address.fromScripthash(
      Buffer.from(sha3_256(redeemScript)),
    ).toString('main');
    expect(htlcAddress).toBe(hsdAddress);
    expect(htlcAddress.startsWith('hs1')).toBe(true);
    expect(createHnsP2wshAddress(redeemScript, 'testnet').startsWith('ts1')).toBe(true);
    expect(createHnsP2wshAddress(redeemScript, 'regtest').startsWith('rs1')).toBe(true);
  });

  it('converts HNS witness addresses to output scripts without Bitcoin hashing', () => {
    const address = p2wpkhAddress(4);
    expect(hnsAddressToOutputScript(address, 'mainnet').toString('hex'))
      .toBe(`0014${'04'.repeat(20)}`);
    expect(() => hnsAddressToOutputScript(address, 'testnet')).toThrow();
  });

  it('builds and signs a claim transaction with the secret and recipient key', () => {
    const toAddress = p2wpkhAddress(5);
    const { txHex } = buildHnsClaimTx({
      utxo,
      redeemScript,
      secret,
      privateKey: recipientSecret,
      toAddress,
      fee: HNS_HTLC_FEE,
      network: 'mainnet',
    });
    const tx = MTX.fromRaw(Buffer.from(txHex, 'hex'));

    expect(tx.version).toBe(0);
    expect(tx.isStandard()).toBe(true);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.inputs[0].prevout.txid()).toBe(utxo.txHash);
    expect(tx.inputs[0].witness.items).toHaveLength(4);
    expect(Buffer.from(tx.inputs[0].witness.items[1]).equals(secret)).toBe(true);
    expect(Buffer.from(tx.inputs[0].witness.items[2]).equals(Buffer.from([1]))).toBe(true);
    expect(Buffer.from(tx.inputs[0].witness.items[3]).equals(redeemScript)).toBe(true);
    expect(tx.outputs[0].address.toString('main')).toBe(toAddress);
    expect(Number(tx.outputs[0].value)).toBe(utxo.value - HNS_HTLC_FEE);

    const hsdScript = Script.fromRaw(redeemScript);
    expect(tx.checksig(
      0,
      hsdScript,
      utxo.value,
      Buffer.from(tx.inputs[0].witness.items[0]),
      recipientPub,
    )).toBe(true);
    expect(tx.checksig(
      0,
      hsdScript,
      utxo.value,
      Buffer.from(tx.inputs[0].witness.items[0]),
      refundPub,
    )).toBe(false);

    const hsdAddress = Address.fromScripthash(
      Buffer.from(sha3_256(redeemScript)),
    );
    expect(() => Script.verify(
      tx.inputs[0].witness,
      hsdAddress,
      tx,
      0,
      utxo.value,
    )).not.toThrow();
  });

  it('builds and signs a refund transaction for the refund key', () => {
    const toAddress = p2wpkhAddress(6);
    const { txHex } = buildHnsRefundTx({
      utxo,
      redeemScript,
      privateKey: refundSecret,
      toAddress,
      fee: HNS_HTLC_FEE,
      locktime: timeout,
      network: 'mainnet',
    });
    const tx = MTX.fromRaw(Buffer.from(txHex, 'hex'));

    expect(tx.version).toBe(0);
    expect(tx.isStandard()).toBe(true);
    expect(tx.locktime).toBe(timeout);
    expect(tx.inputs[0].prevout.txid()).toBe(utxo.txHash);
    expect(tx.inputs[0].sequence).toBe(0xfffffffe);
    expect(tx.inputs[0].witness.items).toHaveLength(3);
    expect(tx.inputs[0].witness.items[1].length).toBe(0);
    expect(Buffer.from(tx.inputs[0].witness.items[2]).equals(redeemScript)).toBe(true);

    const hsdScript = Script.fromRaw(redeemScript);
    expect(tx.checksig(
      0,
      hsdScript,
      utxo.value,
      Buffer.from(tx.inputs[0].witness.items[0]),
      refundPub,
    )).toBe(true);
    expect(tx.checksig(
      0,
      hsdScript,
      utxo.value,
      Buffer.from(tx.inputs[0].witness.items[0]),
      recipientPub,
    )).toBe(false);

    const hsdAddress = Address.fromScripthash(
      Buffer.from(sha3_256(redeemScript)),
    );
    expect(() => Script.verify(
      tx.inputs[0].witness,
      hsdAddress,
      tx,
      0,
      utxo.value,
    )).not.toThrow();
  });

  it('matches hsd signature hashing, serialization, and txid semantics', () => {
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.locktime = 0;
    tx.addInput(Buffer.from(utxo.txHash, 'hex'), utxo.vout, 0xffffffff);
    tx.addOutput(
      hnsAddressToOutputScript(p2wpkhAddress(5), 'mainnet'),
      BigInt(utxo.value - HNS_HTLC_FEE),
    );

    const localHash = hnsSignatureHash(tx, 0, redeemScript, utxo.value);
    const hsdTx = MTX.fromRaw(Buffer.from(serializeHnsTransaction(tx), 'hex'));
    const hsdScript = Script.fromRaw(redeemScript);
    const hsdHash = hsdTx.signatureHash(0, hsdScript, utxo.value, 1);

    expect(hsdHash.toString('hex')).toBe(localHash.toString('hex'));
    expect(hsdTx.txid()).toBe(hnsTransactionId(tx));
  });

  it('rejects a claim that cannot cover the fee', () => {
    expect(() => buildHnsClaimTx({
      utxo: { ...utxo, value: HNS_HTLC_FEE },
      redeemScript,
      secret,
      privateKey: recipientSecret,
      toAddress: p2wpkhAddress(5),
      fee: HNS_HTLC_FEE,
      network: 'mainnet',
    })).toThrow(/fee/i);
  });
});
