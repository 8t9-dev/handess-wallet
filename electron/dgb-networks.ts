import { networks } from 'bitcoinjs-lib';
import type { DgbNetworkType } from '../src/types/swap';

export type { DgbNetworkType };

interface DgbNetwork {
  messagePrefix: string;
  bech32: string;
  bip32: {
    public: number;
    private: number;
  };
  pubKeyHash: number;
  scriptHash: number;
  wif: number;
  genesisHash: string;
  electrumServers: Array<{ host: string; port: number; ssl: boolean }>;
}

export const DGB_MAINNET: DgbNetwork = {
  messagePrefix: '\x19DigiByte Signed Message:\n',
  bech32: 'dgb',
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x1e,
  scriptHash: 0x3e,
  wif: 0x80,
  genesisHash: '7497ea1b465eb39f1c8f507bc877078fe016d6fcb6dfad3a64c98dcc6e1e8496',
  electrumServers: [
    { host: 'electrum1.cipig.net', port: 10059, ssl: false },
    { host: 'electrum2.cipig.net', port: 10059, ssl: false },
    { host: 'electrum1.cipig.net', port: 20059, ssl: true },
    { host: 'electrum2.cipig.net', port: 20059, ssl: true },
  ],
};

export const DGB_TESTNET: DgbNetwork = {
  messagePrefix: '\x19DigiByte Signed Message:\n',
  bech32: 'tdgb',
  bip32: { public: 0x043587cf, private: 0x04358394 },
  pubKeyHash: 0x7e,
  scriptHash: 0x6e,
  wif: 0xef,
  genesisHash: '0c9af936f28f7bd0e90c8f6235399063a026ed267bb53da398313b5d7aa55d82',
  electrumServers: [
    { host: 'electrum1.cipig.net', port: 10059, ssl: false },
  ],
};

export function getDgbNetwork(network: 'mainnet' | 'testnet'): DgbNetwork {
  return network === 'testnet' ? DGB_TESTNET : DGB_MAINNET;
}

export function toBitcoinJsNetwork(net: DgbNetwork): networks.Network {
  return {
    messagePrefix: net.messagePrefix,
    bech32: net.bech32,
    bip32: net.bip32,
    pubKeyHash: net.pubKeyHash,
    scriptHash: net.scriptHash,
    wif: net.wif,
  };
}

export const DGB_BIP44_COIN_TYPE = 20;
export const DGB_DERIVATION_PATH = "m/44'/20'/0'/0/0";
export const DGB_TEST_DERIVATION_PATH = "m/44'/1'/0'/0/0";
