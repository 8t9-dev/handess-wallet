import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bech32 } from 'bech32';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import {
  buildEscrowRedeemScript,
  buildEscrowSpendPsbt,
  buildEscrowSpendPsbtMulti,
  createEscrowUtxo,
  finalizeEscrowPsbt,
  signEscrowPsbt,
} from '../hns-escrow-service';

process.env.NODE_BACKEND = 'js';
const require = createRequire(import.meta.url);
const MTX = require('hsd/lib/primitives/tx');

const SCRIPT = resolve('scripts/escrow-arbiter-sign.mjs');

const buyer = generateSecretKey();
const buyerPub = getPublicKey(buyer);
const seller = generateSecretKey();
const sellerPub = getPublicKey(seller);
const arbiter = generateSecretKey();
const arbiterPub = getPublicKey(arbiter);
const redeem = buildEscrowRedeemScript(buyerPub, sellerPub, arbiterPub);
const amount = 199_950_000;

const tempDirs: string[] = [];

function hnsAddress(seed: number): string {
  const program = Buffer.alloc(20, seed);
  return bech32.encode('hs', [0, ...bech32.toWords(program)]);
}

const sellerAddress = hnsAddress(11);
const buyerAddress = hnsAddress(12);

function makePayloadFile(outputs?: Array<{ address: string; value: number }>): {
  dir: string;
  file: string;
  outputs: Array<{ address: string; value: number }>;
} {
  const dir = mkdtempSync(join(tmpdir(), 'hns-escrow-'));
  tempDirs.push(dir);
  const file = join(dir, 'trade.psbt');
  const targetOutputs = outputs ?? [{ address: sellerAddress, value: amount }];
  const value = targetOutputs.reduce((sum, output) => sum + output.value, 0) + 50_000;
  const utxo = createEscrowUtxo('44'.repeat(32), 1, value, redeem);
  const payload = targetOutputs.length === 1
    ? buildEscrowSpendPsbt(utxo, targetOutputs[0].address, targetOutputs[0].value, 'main')
    : buildEscrowSpendPsbtMulti(utxo, targetOutputs, 'main');
  const buyerSigned = signEscrowPsbt(payload, buyer, buyerPub, 'main');
  writeFileSync(file, buyerSigned, 'utf8');
  return { dir, file, outputs: targetOutputs };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('escrow arbiter signing utility', () => {
  it('adds the arbiter signature and produces a finalizable HNS spend', () => {
    const { file } = makePayloadFile();

    const stdout = execFileSync(
      process.execPath,
      [
        SCRIPT,
        '--network',
        'main',
        '--expect-recipient',
        sellerAddress,
        '--expect-amount',
        String(amount),
        file,
      ],
      {
        env: {
          ...process.env,
          ESCROW_ARBITER_NSEC: nip19.nsecEncode(arbiter),
        },
        encoding: 'utf8',
      },
    );

    const signedPayload = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    expect(signedPayload).toBeTruthy();

    const { txHex, txId } = finalizeEscrowPsbt(signedPayload!, 'main');
    const tx = MTX.fromRaw(Buffer.from(txHex, 'hex'));
    expect(tx.inputs[0].witness.items).toHaveLength(4);
    expect(tx.outputs[0].address.toString('main')).toBe(sellerAddress);
    expect(Number(tx.outputs[0].value)).toBe(amount);
    expect(tx.txid()).toBe(txId);
  });

  it('signs a two-output escrow spend and validates the fee output', () => {
    const outputs = [
      { address: sellerAddress, value: 100_000_000 },
      { address: buyerAddress, value: 5_000_000 },
    ];
    const { file } = makePayloadFile(outputs);

    const stdout = execFileSync(
      process.execPath,
      [
        SCRIPT,
        '--network',
        'main',
        '--expect-recipient',
        sellerAddress,
        '--expect-amount',
        '100000000',
        '--expect-fee-recipient',
        buyerAddress,
        '--expect-fee-amount',
        '5000000',
        file,
      ],
      {
        env: {
          ...process.env,
          ESCROW_ARBITER_NSEC: nip19.nsecEncode(arbiter),
        },
        encoding: 'utf8',
      },
    );

    const signedPayload = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
    const { txHex } = finalizeEscrowPsbt(signedPayload!, 'main');
    const tx = MTX.fromRaw(Buffer.from(txHex, 'hex'));

    expect(tx.outputs).toHaveLength(2);
    expect(tx.outputs[0].address.toString('main')).toBe(sellerAddress);
    expect(tx.outputs[1].address.toString('main')).toBe(buyerAddress);
    expect(Number(tx.outputs[0].value)).toBe(100_000_000);
    expect(Number(tx.outputs[1].value)).toBe(5_000_000);
  });

  it('refuses a payout that does not match the expected recipient', () => {
    const { file } = makePayloadFile();

    expect(() => execFileSync(
      process.execPath,
      [
        SCRIPT,
        '--network',
        'main',
        '--expect-recipient',
        buyerAddress,
        file,
      ],
      {
        env: {
          ...process.env,
          ESCROW_ARBITER_NSEC: nip19.nsecEncode(arbiter),
        },
        stdio: 'pipe',
      },
    )).toThrow();
  });

  it('does not accept a key outside the escrow script', () => {
    const { file } = makePayloadFile();
    const outsider = generateSecretKey();

    expect(() => execFileSync(
      process.execPath,
      [SCRIPT, '--network', 'main', file],
      {
        env: {
          ...process.env,
          ESCROW_ARBITER_NSEC: nip19.nsecEncode(outsider),
        },
        stdio: 'pipe',
      },
    )).toThrow();
  });
});
