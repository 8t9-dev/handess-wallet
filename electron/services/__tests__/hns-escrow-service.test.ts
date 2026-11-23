import { describe, it, expect } from 'vitest';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { createRequire } from 'node:module';
import { bech32 } from 'bech32';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  buildEscrowRedeemScript,
  buildEscrowSpendPsbt,
  buildEscrowSpendPsbtMulti,
  compressedNostrPubkey,
  createEscrowUtxo,
  escrowAddress,
  escrowOutputScript,
  finalizeEscrowPsbt,
  normalizeNostrSecretKey,
  parseEscrowPsbt,
  signEscrowPsbt,
} from '../hns-escrow-service';

process.env.NODE_BACKEND = 'js';
const require = createRequire(import.meta.url);
const MTX = require('hsd/lib/primitives/tx');
const Script = require('hsd/lib/script/script');
const Address = require('hsd/lib/primitives/address');

const buyer = generateSecretKey();
const buyerPub = getPublicKey(buyer);
const seller = generateSecretKey();
const sellerPub = getPublicKey(seller);
const arbiter = generateSecretKey();
const arbiterPub = getPublicKey(arbiter);

const redeemScript = buildEscrowRedeemScript(buyerPub, sellerPub, arbiterPub);
const address = escrowAddress(redeemScript, 'main');
const buyerCompressed = compressedNostrPubkey(buyerPub);
const sellerCompressed = compressedNostrPubkey(sellerPub);

function hnsAddress(seed: number): string {
  const program = Buffer.alloc(20, seed);
  return bech32.encode('hs', [0, ...bech32.toWords(program)]);
}

const recipient = hnsAddress(4);
const buyerRecipient = hnsAddress(5);

describe('HNS 2-of-3 escrow primitives', () => {
  it('derives the HNS SHA3 P2WSH escrow address and output script', () => {
    expect(address.startsWith('hs1')).toBe(true);
    const output = escrowOutputScript(redeemScript);
    expect(output[0]).toBe(0x00);
    expect(output[1]).toBe(0x20);
    expect(output.length).toBe(34);
    expect(output.subarray(2).toString('hex')).toBe(
      Buffer.from(sha3_256(redeemScript)).toString('hex'),
    );
    expect(Address.fromScripthash(
      Buffer.from(sha3_256(redeemScript)),
    ).toString('main')).toBe(address);
  });

  it('uses the expected bech32 prefixes on test networks', () => {
    expect(escrowAddress(redeemScript, 'testnet').startsWith('ts1')).toBe(true);
    expect(escrowAddress(redeemScript, 'regtest').startsWith('rs1')).toBe(true);
  });

  it('normalizes Nostr keys to the even-y compressed key used in the script', () => {
    const normalized = normalizeNostrSecretKey(buyer);
    expect(buyerCompressed[0]).toBe(0x02);

    const hash = Buffer.alloc(32, 7);
    const signature = secp256k1.sign(hash, normalized);
    expect(secp256k1.verify(signature, hash, buyerCompressed)).toBe(true);
  });

  it('builds, co-signs, and finalizes a 2-of-3 HNS release transaction', () => {
    const utxo = createEscrowUtxo('11'.repeat(32), 0, 200_000_000, redeemScript);
    const psbt = buildEscrowSpendPsbt(utxo, recipient, 199_950_000, 'main');
    const parsed = parseEscrowPsbt(psbt);
    expect(parsed.type).toBe('hns-escrow-psbt-v1');
    expect(parsed.outputs).toEqual([{ address: recipient, value: 199_950_000 }]);

    const buyerSigned = signEscrowPsbt(psbt, buyer, buyerPub, 'main');
    const bothSigned = signEscrowPsbt(buyerSigned, seller, sellerPub, 'main');
    const { txHex, txId } = finalizeEscrowPsbt(bothSigned, 'main');

    expect(txId).toMatch(/^[0-9a-f]{64}$/);
    const tx = MTX.fromRaw(Buffer.from(txHex, 'hex'));
    expect(tx.version).toBe(0);
    expect(tx.isStandard()).toBe(true);
    expect(tx.inputs).toHaveLength(1);
    expect(tx.inputs[0].prevout.txid()).toBe(utxo.txHash);
    expect(tx.outputs).toHaveLength(1);
    expect(tx.outputs[0].address.toString('main')).toBe(recipient);
    expect(Number(tx.outputs[0].value)).toBe(199_950_000);
    expect(tx.inputs[0].witness.items).toHaveLength(4);
    expect(tx.inputs[0].witness.items[1].length).toBe(65);
    expect(tx.inputs[0].witness.items[2].length).toBe(65);

    const hsdScript = Script.fromRaw(redeemScript);
    // Signatures are ordered by the redeem-script key order: buyer, seller, arbiter.
    expect(tx.checksig(
      0,
      hsdScript,
      utxo.value,
      Buffer.from(tx.inputs[0].witness.items[1]),
      buyerCompressed,
    )).toBe(true);
    expect(tx.checksig(
      0,
      hsdScript,
      utxo.value,
      Buffer.from(tx.inputs[0].witness.items[2]),
      sellerCompressed,
    )).toBe(true);
    expect(tx.txid()).toBe(txId);

    expect(() => Script.verify(
      tx.inputs[0].witness,
      Address.fromScripthash(
        Buffer.from(sha3_256(redeemScript)),
      ),
      tx,
      0,
      utxo.value,
    )).not.toThrow();
  });

  it('builds, co-signs, and finalizes a multi-output fee spend', () => {
    const utxo = createEscrowUtxo('55'.repeat(32), 0, 200_000_000, redeemScript);
    const psbt = buildEscrowSpendPsbtMulti(
      utxo,
      [
        { address: recipient, value: 100_000_000 },
        { address: buyerRecipient, value: 99_950_000 },
      ],
      'main',
    );

    const buyerSigned = signEscrowPsbt(psbt, buyer, buyerPub, 'main');
    const bothSigned = signEscrowPsbt(buyerSigned, seller, sellerPub, 'main');
    const { txHex } = finalizeEscrowPsbt(bothSigned, 'main');
    const tx = MTX.fromRaw(Buffer.from(txHex, 'hex'));

    expect(tx.outputs).toHaveLength(2);
    expect(Number(tx.outputs[0].value)).toBe(100_000_000);
    expect(Number(tx.outputs[1].value)).toBe(99_950_000);
    expect(tx.outputs[0].address.toString('main')).toBe(recipient);
    expect(tx.outputs[1].address.toString('main')).toBe(buyerRecipient);
  });

  it('cannot finalize with only one signature', () => {
    const utxo = createEscrowUtxo('22'.repeat(32), 0, 200_000_000, redeemScript);
    const psbt = buildEscrowSpendPsbt(utxo, recipient, 199_950_000, 'main');
    const oneSignature = signEscrowPsbt(psbt, buyer, buyerPub, 'main');

    expect(() => finalizeEscrowPsbt(oneSignature, 'main')).toThrow(/two/i);
  });

  it('rejects a payout that does not leave a fee', () => {
    const utxo = createEscrowUtxo('33'.repeat(32), 0, 200_000_000, redeemScript);
    expect(() =>
      buildEscrowSpendPsbt(utxo, recipient, 200_000_000, 'main'),
    ).toThrow(/fee/i);
  });

  it('rejects malformed or off-curve Nostr public keys', () => {
    expect(() => compressedNostrPubkey('abcd')).toThrow(/public key/i);
    expect(() => compressedNostrPubkey('11'.repeat(32))).toThrow(/public key/i);
    expect(() =>
      buildEscrowRedeemScript(buyerPub, sellerPub, 'not-a-key'),
    ).toThrow(/public key/i);
  });

  it('rejects duplicate escrow participants', () => {
    expect(() =>
      buildEscrowRedeemScript(buyerPub, buyerPub, arbiterPub),
    ).toThrow(/distinct/i);
    expect(() =>
      buildEscrowRedeemScript(buyerPub, sellerPub, buyerPub),
    ).toThrow(/distinct/i);
  });
});
