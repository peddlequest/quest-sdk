/**
 * The Merkle construction `PeddlesQuestEscrow` verifies against.
 *
 * Matched to api/src/server/services/escrow/merkle.ts (the source of truth)
 * and to the contract:
 *
 *   claim():   leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
 *   _verify(): node = keccak256(abi.encode(min(a, b), max(a, b)))   // as uint256
 *
 * Leaves sorted ascending by leaf hash read as uint256; the last node of an odd
 * level is promoted unchanged, never paired with itself.
 */
import { encodeAbiParameters, getAddress, hexToBigInt, isAddress, keccak256, type Hex } from 'viem';

/** Base units as a decimal string or a bigint. Never a JS number. */
export type BaseUnits = string | bigint;

const toBaseUnits = (amount: BaseUnits): bigint => {
  if (typeof amount === 'bigint') return amount;
  if (typeof amount !== 'string' || !/^\d+$/.test(amount))
    throw new Error(`merkle: amount ${String(amount)} must be a base-unit decimal string or a bigint`);
  return BigInt(amount);
};

/** `keccak256(bytes.concat(keccak256(abi.encode(address account, uint256 amount))))`. */
export const leafHash = (account: string, amount: BaseUnits): Hex => {
  if (!isAddress(account, { strict: false })) throw new Error(`merkle: "${account}" is not an EVM address`);
  const value = toBaseUnits(amount);
  if (value <= 0n) throw new Error(`merkle: amount ${value} is not positive`);
  const inner = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [getAddress(account), value]),
  );
  return keccak256(inner);
};

/** One internal node: the pair sorted by unsigned big-endian value, then hashed. */
export const hashPair = (a: Hex, b: Hex): Hex => {
  const [left, right] = hexToBigInt(a) <= hexToBigInt(b) ? [a, b] : [b, a];
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes32' }], [left, right]));
};

/** Fold a proof into its leaf and compare with `root` (the contract's `_verify`). */
export const verifyMerkleProof = (root: Hex, account: string, amount: BaseUnits, proof: readonly Hex[]): boolean => {
  let computed = leafHash(account, amount);
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
};

export interface MerkleEntry {
  account: string;
  amount: BaseUnits;
}

/**
 * Rebuild the root from (account, amount) pairs, in any order. Refuses an
 * empty list, a duplicate account and a non-positive amount, exactly as the
 * backend's builder does - a list it would refuse cannot have produced a root.
 */
export const computeMerkleRoot = (entries: readonly MerkleEntry[]): Hex => {
  if (!entries.length) throw new Error('merkle: no leaves');
  const seen = new Set<string>();
  const leaves = entries.map((entry) => {
    const key = entry.account.toLowerCase();
    if (seen.has(key)) throw new Error(`merkle: ${entry.account} appears more than once`);
    seen.add(key);
    return leafHash(entry.account, entry.amount);
  });
  leaves.sort((a, b) => {
    const left = hexToBigInt(a);
    const right = hexToBigInt(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });

  let level = leaves;
  while (level.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    level = next;
  }
  return level[0];
};
