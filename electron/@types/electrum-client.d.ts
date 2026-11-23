declare module '@keep-network/electrum-client-js' {
  interface ElectrumBalance {
    confirmed: number;
    unconfirmed: number;
  }

  interface ElectrumUtxo extends Record<string, unknown> {
    tx_hash: string;
    tx_pos: number;
    value: number;
    height: number;
    confirmations: number;
    address: string;
    scriptPubKey: string;
  }

  interface ElectrumHeader {
    height: number;
    hex: string;
  }

  class ElectrumClient {
    constructor(host: string, port: number, protocol: 'tls' | 'tcp');
    connect(clientName: string, electrumProtocolVersion: string, persistencePolicy?: { maxRetry: number; callback: (() => void) | null }): Promise<void>;
    close(): Promise<void>;
    blockchain_address_getBalance(address: string): Promise<ElectrumBalance>;
    blockchain_address_listunspent(address: string): Promise<ElectrumUtxo[]>;
    blockchain_scripthash_getBalance(scripthash: string): Promise<ElectrumBalance>;
    blockchain_scripthash_listunspent(scripthash: string): Promise<ElectrumUtxo[]>;
    blockchain_scripthash_getHistory(
      scripthash: string,
    ): Promise<Array<{ tx_hash: string; height: number }>>;
    request(method: string, params: unknown[]): Promise<Record<string, unknown>>;
    blockchain_transaction_broadcast(rawTxHex: string): Promise<string>;
    blockchain_transaction_get(txHash: string, verbose?: boolean): Promise<Record<string, unknown>>;
    blockchainEstimatefee(blocks: number): Promise<number>;
    blockchain_headers_subscribe(): Promise<ElectrumHeader>;
  }

  export default ElectrumClient;
}
