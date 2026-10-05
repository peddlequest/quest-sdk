import { getAddress, type Address } from 'viem';

/**
 * Where the PeddleQuest contracts live.
 *
 * Source: docs/monetization.md §7 (mainnet, deployed 2026-10-02 from nonce 0
 * on every chain, so the four addresses are identical on all four mainnets)
 * and §6k (Sepolia, the live testnet set). Sourcify exact_match on all sixteen
 * mainnet contracts.
 *
 * THE CONTRACTS ARE UNAUDITED. `PeddlesQuestEscrow` custodies third-party
 * funds; the per-quest deposit cap is the blast radius of any one bug. Nothing
 * in this package means otherwise.
 */
export interface PeddleQuestContracts {
  feeRouter: Address;
  escrow: Address;
  promotionMarket: Address;
  badge: Address;
}

export interface PeddleQuestChain {
  /** EIP-155 chain id. */
  id: number;
  /** The same id as the API writes it: lowercase hex, e.g. `0x2105`. */
  hexId: `0x${string}`;
  name: string;
  /** Symbol of the native coin pools and fees are paid in. */
  nativeSymbol: string;
  mainnet: boolean;
  contracts: PeddleQuestContracts;
}

const MAINNET: PeddleQuestContracts = {
  feeRouter: getAddress('0x0c90BD0A17879C9b627705206522020078C51231'),
  escrow: getAddress('0x16267bE6D067b3d411bf779B5aD041f9eba4CadE'),
  promotionMarket: getAddress('0x704E5eA6752EbfcEDB377512b67c0138461f4849'),
  badge: getAddress('0x6DA219d4072A91665F702e34ca6CcaCd3eA7AE91'),
};

const SEPOLIA: PeddleQuestContracts = {
  feeRouter: getAddress('0x06f0464D685A22503CcbBA7126eB91943c4c5b09'),
  escrow: getAddress('0xB55844D1ED3FACba7310137cA5F9d2ed70B1d462'),
  promotionMarket: getAddress('0x34E9876b90AD59615F7eDB52f3d122260d8aD623'),
  badge: getAddress('0x7B3C605AA935E96e2319A54bBBC285B8331b39b0'),
};

const chain = (id: number, name: string, nativeSymbol: string, mainnet: boolean, contracts: PeddleQuestContracts): PeddleQuestChain => ({
  id,
  hexId: `0x${id.toString(16)}`,
  name,
  nativeSymbol,
  mainnet,
  contracts,
});

/** Every chain PeddleQuest is deployed on, keyed by EIP-155 id. */
export const PEDDLEQUEST_CHAINS = {
  8453: chain(8453, 'Base', 'ETH', true, MAINNET),
  4663: chain(4663, 'Robinhood Chain', 'ETH', true, MAINNET),
  56: chain(56, 'BNB Smart Chain', 'BNB', true, MAINNET),
  // On Arc the native coin IS USDC (18 decimals natively); pools there are native only.
  5042: chain(5042, 'Arc', 'USDC', true, MAINNET),
  11155111: chain(11155111, 'Sepolia', 'ETH', false, SEPOLIA),
} as const satisfies Record<number, PeddleQuestChain>;

export type PeddleQuestChainId = keyof typeof PEDDLEQUEST_CHAINS;

export const SUPPORTED_CHAIN_IDS = Object.keys(PEDDLEQUEST_CHAINS).map(Number) as PeddleQuestChainId[];

/** The zero address: how the escrow and the API name a chain's native coin. */
export const NATIVE_ASSET: Address = '0x0000000000000000000000000000000000000000';

/**
 * Accepts `8453`, `'8453'` or the API's hex form `'0x2105'`. Throws on a chain
 * PeddleQuest is not deployed on, rather than returning an address that is
 * empty there.
 */
export const getChain = (chainId: number | string): PeddleQuestChain => {
  const id = typeof chainId === 'number' ? chainId : /^0x/i.test(chainId) ? parseInt(chainId, 16) : Number(chainId);
  const found = (PEDDLEQUEST_CHAINS as Record<number, PeddleQuestChain>)[id];
  if (!found) throw new Error(`peddlequest: chain ${chainId} has no PeddleQuest deployment`);
  return found;
};

export const getContracts = (chainId: number | string): PeddleQuestContracts => getChain(chainId).contracts;
