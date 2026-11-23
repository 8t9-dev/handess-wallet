import * as crypto from 'crypto';
import * as bitcoin from 'bitcoinjs-lib';
import ElectrumClient from '@keep-network/electrum-client-js';
import { patchElectrumClientNotifications } from './electrum-client-compat';
import type { DgbBalance, DgbUtxo, DgbNetworkType } from '../../src/types/swap';
import { getDgbNetwork, toBitcoinJsNetwork } from '../dgb-networks';

function addressToScripthash(address: string, network: bitcoin.Network): string {
  const script = bitcoin.address.toOutputScript(address, network);
  const hash = crypto.createHash('sha256').update(script).digest();
  return Buffer.from(hash).reverse().toString('hex');
}

export class ElectrumDgbService {
  private client: ElectrumClient | null = null;
  private connected = false;
  private host = '';
  private port = 0;
  private ssl = false;
  private network: DgbNetworkType = 'mainnet';

  isConnected(): boolean {
    return this.connected;
  }

  getServerInfo(): { host: string; port: number; ssl: boolean; network: DgbNetworkType } {
    return { host: this.host, port: this.port, ssl: this.ssl, network: this.network };
  }

  async connect(host: string, port: number, ssl: boolean, network: DgbNetworkType = 'mainnet'): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    this.host = host;
    this.port = port;
    this.ssl = ssl;
    this.network = network;

    const net = getDgbNetwork(network);
    const electrumHost = host || net.electrumServers[0].host;
    const electrumPort = port || net.electrumServers[0].port;
    const useSsl = ssl !== undefined ? ssl : net.electrumServers[0].ssl;

    try {
      this.client = new ElectrumClient(electrumHost, electrumPort, useSsl ? 'tls' : 'tcp');
      patchElectrumClientNotifications(this.client);
      await this.client.connect('bob-wallet-crm', '1.4');

      // A server can be reachable while being on the wrong chain. Verify the
      // genesis hash before deriving addresses or querying balances.
      const features = await this.client.request('server.features', []);
      const genesis = String(features.genesis_hash || '').toLowerCase();
      if (genesis !== net.genesisHash) {
        try { await this.client.close(); } catch { /* ignore */ }
        this.client = null;
        throw new Error(
          `Connected server is not a DigiByte ${network} server. `
          + `Use a ${network} Electrum server.`,
        );
      }

      this.connected = true;
    } catch (err) {
      this.connected = false;
      if (this.client) {
        try { await this.client.close(); } catch { /* ignore */ }
        this.client = null;
      }
      throw new Error(`Failed to connect to Electrum-DGB server: ${err}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      try {
        await this.client.close();
      } catch { /* ignore */ }
    }
    this.client = null;
    this.connected = false;
  }

  private ensureConnected(): ElectrumClient {
    if (!this.client || !this.connected) {
      throw new Error('Electrum-DGB not connected');
    }
    return this.client;
  }

  async getBalance(address: string): Promise<DgbBalance> {
    const client = this.ensureConnected();
    try {
      const net = toBitcoinJsNetwork(getDgbNetwork(this.network));
      const scripthash = addressToScripthash(address, net);
      const result = await client.blockchain_scripthash_getBalance(scripthash);
      return {
        confirmed: result.confirmed,
        unconfirmed: result.unconfirmed,
      };
    } catch (err) {
      console.error('[ElectrumDGB] getBalance error:', err);
      return { confirmed: 0, unconfirmed: 0 };
    }
  }

  async listUnspent(address: string): Promise<DgbUtxo[]> {
    const client = this.ensureConnected();
    try {
      const net = toBitcoinJsNetwork(getDgbNetwork(this.network));
      const scripthash = addressToScripthash(address, net);
      const utxos = await client.blockchain_scripthash_listunspent(scripthash);
      return (utxos || []).map((u: Record<string, unknown>) => ({
        txHash: String(u.tx_hash || ''),
        vout: Number(u.tx_pos ?? 0),
        value: Number(u.value ?? 0),
        height: Number(u.height ?? 0),
        confirmations: Number(u.confirmations ?? 0),
        address: String(u.address || ''),
        scriptPubKey: String(u.scriptPubKey || ''),
      }));
    } catch (err) {
      console.error('[ElectrumDGB] listUnspent error:', err);
      return [];
    }
  }

  async getHistory(
    address: string,
  ): Promise<Array<{ txHash: string; height: number }>> {
    const client = this.ensureConnected();
    try {
      const net = toBitcoinJsNetwork(getDgbNetwork(this.network));
      const scripthash = addressToScripthash(address, net);
      const history = await client.blockchain_scripthash_getHistory(scripthash);
      return (history || []).map(entry => ({
        txHash: String(entry.tx_hash || ''),
        height: Number(entry.height ?? 0),
      })).filter(entry => /^[0-9a-f]{64}$/.test(entry.txHash));
    } catch (err) {
      console.error('[ElectrumDGB] getHistory error:', err);
      return [];
    }
  }

  async broadcastTransaction(rawTxHex: string): Promise<string> {
    const client = this.ensureConnected();
    try {
      const txid = await client.blockchain_transaction_broadcast(rawTxHex);
      return String(txid);
    } catch (err) {
      throw new Error(`Failed to broadcast DGB transaction: ${err}`);
    }
  }

  async getTransaction(
    txHash: string,
    verbose = true,
  ): Promise<Record<string, unknown> | null> {
    const client = this.ensureConnected();
    try {
      const tx = await client.blockchain_transaction_get(txHash, verbose);
      if (verbose) return (tx as Record<string, unknown>) || null;
      return { hex: String(tx || '') };
    } catch (err) {
      console.error('[ElectrumDGB] getTransaction error:', err);
      return null;
    }
  }

  async getRawTransaction(txHash: string): Promise<string | null> {
    const result = await this.getTransaction(txHash, false);
    return result?.hex ? String(result.hex) : null;
  }

  async estimateFee(blocks: number = 2): Promise<number> {
    const client = this.ensureConnected();
    try {
      const fee = await client.blockchainEstimatefee(blocks);
      return Number(fee) || 0.00001;
    } catch {
      return 0.00001;
    }
  }

  async getCurrentBlockHeight(): Promise<number> {
    const client = this.ensureConnected();
    try {
      const header = await client.blockchain_headers_subscribe();
      return Number(header?.height ?? 0);
    } catch {
      return 0;
    }
  }
}

export const electrumDgbService = new ElectrumDgbService();
