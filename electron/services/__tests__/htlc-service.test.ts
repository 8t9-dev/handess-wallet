import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import * as tinysecp from 'tiny-secp256k1';
import {
  buildDgbClaimTx,
  buildDgbFundingTx,
  buildDgbRefundTx,
  buildHtlcRedeemScript,
  createP2shAddress,
} from '../htlc-service';
import { getDgbNetwork, toBitcoinJsNetwork } from '../../dgb-networks';

const privateKey = Buffer.alloc(32, 3);
const publicKey = Buffer.from(secp256k1.getPublicKey(privateKey, true));
const recipientKey = Buffer.alloc(32, 4);
const recipientPubKey = Buffer.from(secp256k1.getPublicKey(recipientKey, true));
const secret = Buffer.alloc(32, 5);
const secretHash = createHash('sha256').update(secret).digest();
const timeout = 2_000;
const redeemScript = buildHtlcRedeemScript(
  secretHash,
  recipientPubKey,
  publicKey,
  timeout,
);
const network = toBitcoinJsNetwork(getDgbNetwork('mainnet'));
const walletAddress = bitcoin.payments.p2pkh({
  pubkey: publicKey,
  network,
}).address!;
const recipientAddress = bitcoin.payments.p2pkh({
  pubkey: Buffer.from(secp256k1.getPublicKey(Buffer.alloc(32, 6), true)),
  network,
}).address!;
const p2sh = createP2shAddress(redeemScript, 'mainnet');

function verifiesWithLibsecp(
  signature: Uint8Array,
  hash: Uint8Array,
  pubkey: Buffer,
): boolean {
  // bitcoinjs returns the decoded signature as a 64-byte compact signature.
  return tinysecp.verify(hash, pubkey, Buffer.from(signature));
}

describe('DGB HTLC primitives', () => {
  it('derives a P2SH address whose output script matches the redeem script', () => {
    expect(p2sh.address.startsWith('S')).toBe(true);
    expect(p2sh.outputScript.equals(
      bitcoin.payments.p2sh({ redeem: { output: redeemScript }, network }).output!,
    )).toBe(true);
  });

  it('builds and signs a claim transaction with the secret', () => {
    const { txHex, txId } = buildDgbClaimTx({
      utxo: { txHash: '22'.repeat(32), vout: 0, value: 100_000_000 },
      redeemScript,
      secret,
      privateKey: recipientKey,
      toAddress: recipientAddress,
      fee: 10_000,
      network: 'mainnet',
    });
    const tx = bitcoin.Transaction.fromHex(txHex);
    expect(txId).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(tx.outs[0].value)).toBe(99_990_000);
    expect(Buffer.from(tx.outs[0].script).equals(
      bitcoin.address.toOutputScript(recipientAddress, network),
    )).toBe(true);

    const chunks = bitcoin.script.decompile(tx.ins[0].script)!;
    expect(chunks).toHaveLength(4);
    expect(Buffer.from(chunks[0] as Buffer).length).toBeGreaterThan(60);
    expect(Buffer.from(chunks[1] as Buffer).equals(secret)).toBe(true);
    expect(chunks[2]).toBe(bitcoin.opcodes.OP_1);
    expect(Buffer.from(chunks[3] as Buffer).equals(redeemScript)).toBe(true);

    const hash = tx.hashForSignature(0, redeemScript, bitcoin.Transaction.SIGHASH_ALL);
    const decoded = bitcoin.script.signature.decode(Buffer.from(chunks[0] as Buffer));
    expect(verifiesWithLibsecp(decoded.signature, hash, recipientPubKey)).toBe(true);
  });

  it('builds and signs a refund transaction with locktime', () => {
    const { txHex } = buildDgbRefundTx({
      utxo: { txHash: '33'.repeat(32), vout: 0, value: 100_000_000 },
      redeemScript,
      privateKey,
      toAddress: walletAddress,
      fee: 10_000,
      locktime: timeout,
      network: 'mainnet',
    });
    const tx = bitcoin.Transaction.fromHex(txHex);
    expect(tx.locktime).toBe(timeout);
    expect(tx.ins[0].sequence).toBe(0xfffffffe);

    const chunks = bitcoin.script.decompile(tx.ins[0].script)!;
    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toBe(bitcoin.opcodes.OP_0);
    expect(Buffer.from(chunks[2] as Buffer).equals(redeemScript)).toBe(true);

    const hash = tx.hashForSignature(0, redeemScript, bitcoin.Transaction.SIGHASH_ALL);
    const decoded = bitcoin.script.signature.decode(Buffer.from(chunks[0] as Buffer));
    expect(verifiesWithLibsecp(decoded.signature, hash, publicKey)).toBe(true);
  });

  it('builds and signs a P2PKH funding transaction into the HTLC', () => {
    const { txHex, txId, fee } = buildDgbFundingTx({
      utxos: [{ txHash: '44'.repeat(32), vout: 1, value: 150_000_000 }],
      privateKey,
      changeAddress: walletAddress,
      htlcScript: redeemScript,
      htlcAmount: 100_000_000,
      feeRateSatPerKb: 20_000,
      network: 'mainnet',
    });
    const tx = bitcoin.Transaction.fromHex(txHex);
    expect(txId).toMatch(/^[0-9a-f]{64}$/);
    expect(fee).toBeGreaterThan(0);
    expect(Buffer.from(tx.outs[0].script).equals(p2sh.outputScript)).toBe(true);
    expect(Number(tx.outs[0].value)).toBe(100_000_000);

    const prevScript = bitcoin.address.toOutputScript(walletAddress, network);
    for (let i = 0; i < tx.ins.length; i += 1) {
      const chunks = bitcoin.script.decompile(tx.ins[i].script)!;
      expect(chunks).toHaveLength(2);
      expect(Buffer.from(chunks[1] as Buffer).equals(publicKey)).toBe(true);
      const hash = tx.hashForSignature(i, prevScript, bitcoin.Transaction.SIGHASH_ALL);
      const decoded = bitcoin.script.signature.decode(Buffer.from(chunks[0] as Buffer));
      expect(verifiesWithLibsecp(decoded.signature, hash, publicKey)).toBe(true);
    }
  });
});
