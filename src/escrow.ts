import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex, type PublicClient } from 'viem';

import { peddlesQuestEscrowAbi } from './abis';
import { getContracts } from './chains';
import type { EscrowProof } from './types';

/**
 * `keccak256(abi.encode(uint256 loyaltyProjectId, uint256 contractId))` - the
 * pool's bytes32 id on `PeddlesQuestEscrow`.
 *
 * Mirrors api/src/server/services/escrow/questId.ts. `contractId` is the id of
 * the reward's contract row on the PeddleQuest API (`fullRewards.rewards[].contractId`),
 * which is a real row even for a native-coin reward; `null` is the backend's
 * sentinel 0 for a pool with no contract row at all.
 *
 * The backend derives the id ONCE and stores it; the API's `questId` field
 * (`getQuestEscrow`) is the authority for an existing pool. Use this to
 * cross-check, or to compute a pool id before it exists.
 */
export const deriveEscrowQuestId = (loyaltyProjectId: number | bigint, contractId: number | bigint | null): Hex => {
  const project = BigInt(loyaltyProjectId);
  if (project <= 0n) throw new Error(`escrow: loyaltyProjectId ${loyaltyProjectId} is not a usable id`);
  const contract = contractId === null ? 0n : BigInt(contractId);
  if (contract < 0n) throw new Error(`escrow: contractId ${contractId} is not a usable id`);
  return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [project, contract]));
};

/** `PeddlesQuestEscrow.questOf`, as read from chain. Amounts in base units of `rewardToken`. */
export interface QuestPool {
  questId: Hex;
  escrow: Address;
  creator: Address;
  /** Zero address = the chain's native coin. */
  rewardToken: Address;
  /** Pool net of the deposit fee, base units. */
  funded: bigint;
  claimed: bigint;
  /** `funded - claimed`. */
  remaining: bigint;
  /** Unix seconds; 0 until finalised. */
  claimsOpenAt: bigint;
  /** Unix seconds. */
  claimDeadline: bigint;
  /** 0x00..00 until the operator publishes winners. */
  merkleRoot: Hex;
  finalised: boolean;
  swept: boolean;
  /** False when `questOf` returned the empty struct (no pool with that id). */
  exists: boolean;
}

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Read one pool with `questOf(questId)`. Pass the escrow address to override
 * the deployment table (e.g. a superseded Sepolia escrow).
 */
export const getQuestPool = async (
  publicClient: Pick<PublicClient, 'readContract'>,
  chainId: number | string,
  questId: Hex,
  options: { escrow?: Address; blockNumber?: bigint } = {},
): Promise<QuestPool> => {
  const escrow = options.escrow ? getAddress(options.escrow) : getContracts(chainId).escrow;
  const pool = await publicClient.readContract({
    address: escrow,
    abi: peddlesQuestEscrowAbi,
    functionName: 'questOf',
    args: [questId],
    ...(options.blockNumber !== undefined ? { blockNumber: options.blockNumber } : {}),
  });
  return {
    questId,
    escrow,
    creator: pool.creator,
    rewardToken: pool.rewardToken,
    funded: pool.funded,
    claimed: pool.claimed,
    remaining: pool.funded - pool.claimed,
    claimsOpenAt: BigInt(pool.claimsOpenAt),
    claimDeadline: BigInt(pool.claimDeadline),
    merkleRoot: pool.merkleRoot,
    finalised: pool.finalised,
    swept: pool.swept,
    exists: pool.creator.toLowerCase() !== ZERO,
  };
};

/** Read `hasClaimed(questId, account)` - the chain, not the API, is the authority. */
export const hasClaimed = async (
  publicClient: Pick<PublicClient, 'readContract'>,
  chainId: number | string,
  questId: Hex,
  account: Address,
  options: { escrow?: Address } = {},
): Promise<boolean> =>
  publicClient.readContract({
    address: options.escrow ? getAddress(options.escrow) : getContracts(chainId).escrow,
    abi: peddlesQuestEscrowAbi,
    functionName: 'hasClaimed',
    args: [questId, getAddress(account)],
  });

export interface ClaimCall {
  address: Address;
  abi: typeof peddlesQuestEscrowAbi;
  functionName: 'claim';
  args: readonly [Hex, Address, bigint, readonly Hex[]];
  chainId: number;
}

/**
 * The `claim(questId, account, amount, proof)` call for one proof served by
 * `GET /loyalty-project/:link/claim/proof` (see `client.getClaimProofs`).
 *
 * Returns a plain object you can spread into viem's `writeContract` or
 * `simulateContract`, or wagmi's `useWriteContract`. It sends nothing.
 *
 * The escrow address comes from the proof, and is refused if it is not the
 * PeddleQuest escrow on that chain - a proof is data from a server, and the
 * address it names is where a wallet will be asked to send a transaction.
 * Anyone may submit the call; the reward always goes to `proof.account`.
 */
export const buildClaimCall = (proof: Pick<EscrowProof, 'chainId' | 'escrowAddress' | 'questId' | 'account' | 'amount' | 'proof'>, options: { allowEscrow?: Address } = {}): ClaimCall => {
  const expected = options.allowEscrow ? getAddress(options.allowEscrow) : getContracts(proof.chainId).escrow;
  const address = getAddress(proof.escrowAddress);
  if (address !== expected)
    throw new Error(`escrow: proof names escrow ${address}, but the PeddleQuest escrow on chain ${proof.chainId} is ${expected}`);
  if (!/^\d+$/.test(proof.amount)) throw new Error(`escrow: proof amount "${proof.amount}" is not a base-unit string`);
  const chainId = /^0x/i.test(String(proof.chainId)) ? parseInt(String(proof.chainId), 16) : Number(proof.chainId);
  return {
    address,
    abi: peddlesQuestEscrowAbi,
    functionName: 'claim',
    args: [proof.questId as Hex, getAddress(proof.account), BigInt(proof.amount), proof.proof as Hex[]],
    chainId,
  };
};
