/**
 * Verify a published winner snapshot against the escrow.
 *
 * A pool's winners are decided off chain; the chain only stores a 32-byte
 * Merkle root. The snapshot (pinned to IPFS by the finaliser, linked from the
 * quest page and from `client.getQuestEscrow()` as `winnerSnapshotUrl`) is
 * what lets anyone check that root without trusting PeddleQuest.
 *
 * Format: "winner snapshot v1" (`schema: 'peddlequest-winner-snapshot-v1'`),
 * as built by api/src/server/services/escrow/snapshot.ts and checked by
 * scripts/verify-winners/verify.mjs. Leaf encoding from
 * api/src/server/services/escrow/merkle.ts.
 *
 * TODO(winner-snapshot v1): the snapshot format landed in the backend on
 * 2026-10-03 and was still uncommitted when this SDK was written. Re-check the
 * field names below against snapshot.ts once it is committed and the first
 * real snapshot is pinned; `WinnerSnapshotV1` must stay a mirror of the
 * backend's `WinnerSnapshot`, not a second design.
 *
 * What a MATCH proves: the published root pays exactly the wallets and amounts
 * in the file, those amounts sum to no more than the pool, and (for a
 * scoreboard quest) each place earned exactly the tiers covering it. What it
 * does NOT prove: the points themselves - task verification is off chain, and
 * several task types are self-attested.
 */
import { getAddress, hexToBigInt, isAddress, sha256, type Address, type Hex, type PublicClient } from 'viem';

import { peddlesQuestEscrowAbi } from './abis';
import { PEDDLEQUEST_CHAINS, NATIVE_ASSET } from './chains';
import { computeMerkleRoot, leafHash } from './merkle';

export const WINNER_SNAPSHOT_SCHEMA = 'peddlequest-winner-snapshot-v1' as const;

export interface WinnerSnapshotRowV1 {
  place: number | null;
  points: string | null;
  tieBreak: { lastCompletedAt: string | null; lastCreatedAt: string | null } | null;
  /** Base units, decimal string. */
  amount: string;
}

export interface WinnerSnapshotLeafV1 {
  account: string;
  /** Base units, decimal string. */
  amount: string;
  leaf: Hex;
}

/** Mirror of the backend's `WinnerSnapshot` ("winner snapshot v1"). */
export interface WinnerSnapshotV1 {
  schema: typeof WINNER_SNAPSHOT_SCHEMA;
  chainId: number;
  escrow: string;
  questId: Hex;
  quest: { loyaltyProjectId: number; linkTitle: string; type: string; endAt: string | null; threshold: string | null };
  asset: { token: string; native: boolean; decimals: number };
  funded: string;
  totalAllocated: string;
  rules: { ranking: string; tiers: { rewardId: number; startPlace: number | null; endPlace: number | null; amount: string }[] };
  scoreboard: WinnerSnapshotRowV1[];
  merkle: {
    format: 'peddles-quest-escrow-merkle-v1';
    encoding: Record<string, unknown>;
    leaves: WinnerSnapshotLeafV1[];
    root: Hex;
  };
}

export interface VerifyWinnersOptions {
  /** IPFS gateway for `ipfs://` or bare-CID sources. Default `https://ipfs.io`. */
  gateway?: string;
  fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;
  /** Compare against this root instead of reading the chain (offline check). */
  root?: Hex;
}

export interface VerifyWinnersResult {
  /** True only if every check passed. */
  match: boolean;
  /** Every failed check, human-readable. Empty on a match. */
  failures: string[];
  /** Things worth knowing that are not failures (e.g. the content was not hash-checked against a CID). */
  notes: string[];
  computedRoot: Hex | null;
  /** The root compared against: on chain, or `options.root`. */
  referenceRoot: Hex | null;
  referenceSource: 'chain' | 'supplied' | null;
  totalAllocated: bigint;
  snapshot: WinnerSnapshotV1;
}

const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

const base32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

/** CIDv1, codec raw (0x55), sha2-256 - what `ipfs add --cid-version=1` makes for a single-block file. */
export const rawCidOf = (bytes: Uint8Array): string => {
  const digest = sha256(bytes, 'bytes');
  const prefixed = new Uint8Array(4 + digest.length);
  prefixed.set([0x01, 0x55, 0x12, 0x20]);
  prefixed.set(digest, 4);
  return `b${base32(prefixed)}`;
};

const loadSnapshot = async (
  source: WinnerSnapshotV1 | string,
  options: VerifyWinnersOptions,
  notes: string[],
): Promise<WinnerSnapshotV1> => {
  if (typeof source !== 'string') return source;
  const text = source.trim();
  if (text.startsWith('{')) return JSON.parse(text) as WinnerSnapshotV1;

  const fetchImpl = options.fetch ?? (globalThis as { fetch?: VerifyWinnersOptions['fetch'] }).fetch;
  if (!fetchImpl) throw new Error('verifyWinners: no fetch available; pass `fetch` in the options');

  const cid = text.replace(/^ipfs:\/\//i, '');
  const isCid = CID_RE.test(cid);
  const url = isCid ? `${(options.gateway ?? 'https://ipfs.io').replace(/\/+$/, '')}/ipfs/${cid}` : text;
  if (!isCid && !/^https?:\/\//i.test(url)) throw new Error('verifyWinners: source must be a snapshot object, JSON text, an https URL, or a CID');

  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`verifyWinners: ${url} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());

  // A gateway-path URL carries its CID too.
  const urlCid = isCid ? cid : /\/ipfs\/([^/?#]+)/.exec(url)?.[1];
  if (urlCid && urlCid.startsWith('bafkrei')) {
    const actual = rawCidOf(bytes);
    if (actual !== urlCid) throw new Error(`verifyWinners: the content does not hash to ${urlCid} (got ${actual}); the gateway substituted a file`);
    notes.push(`content hash matches CID ${urlCid}`);
  } else if (urlCid) {
    notes.push(`CID ${urlCid} is not a single-block raw CID; its content was NOT hash-checked - fetch it from a node you trust`);
  } else {
    notes.push(`loaded from a URL; the content was not tied to a CID (as a raw CID it would be ${rawCidOf(bytes)})`);
  }

  return JSON.parse(new TextDecoder().decode(bytes)) as WinnerSnapshotV1;
};

/**
 * Recompute every leaf and the root of a winner snapshot, check its
 * arithmetic, then compare with `questOf(questId)` on the escrow. Reads only.
 *
 * @param source  the snapshot object, its JSON text, an https URL, `ipfs://<cid>` or a bare CID
 * @param publicClient  a viem client on the snapshot's chain (`null` with `options.root` for an offline check)
 */
export const verifyWinners = async (
  source: WinnerSnapshotV1 | string,
  publicClient: Pick<PublicClient, 'readContract' | 'getChainId'> | null,
  options: VerifyWinnersOptions = {},
): Promise<VerifyWinnersResult> => {
  const notes: string[] = [];
  const failures: string[] = [];
  const fail = (message: string) => failures.push(message);

  const snapshot = await loadSnapshot(source, options, notes);
  if (snapshot?.schema !== WINNER_SNAPSHOT_SCHEMA) fail(`unknown schema "${String(snapshot?.schema)}"`);

  const leaves = Array.isArray(snapshot?.merkle?.leaves) ? snapshot.merkle.leaves : [];
  if (!leaves.length) fail('the snapshot has no leaves');

  const seen = new Set<string>();
  const valid: { account: string; amount: string }[] = [];
  const hashes: Hex[] = [];
  let total = 0n;

  leaves.forEach((leaf, index) => {
    if (!isAddress(leaf.account ?? '', { strict: false })) return fail(`leaf ${index}: "${leaf.account}" is not an address`);
    if (!/^[0-9]+$/.test(String(leaf.amount))) return fail(`leaf ${index}: amount "${leaf.amount}" is not a base-unit integer string`);
    const amount = BigInt(leaf.amount);
    if (amount <= 0n) return fail(`leaf ${index}: amount is not positive`);
    const key = leaf.account.toLowerCase();
    if (seen.has(key)) return fail(`leaf ${index}: ${leaf.account} appears twice (the contract pays an account once)`);
    seen.add(key);
    total += amount;
    const hash = leafHash(leaf.account, amount);
    if (leaf.leaf && hash.toLowerCase() !== String(leaf.leaf).toLowerCase())
      fail(`leaf ${index}: published leaf ${leaf.leaf} != recomputed ${hash} for (${leaf.account}, ${leaf.amount})`);
    hashes.push(hash);
    valid.push({ account: leaf.account, amount: String(leaf.amount) });
  });

  for (let i = 1; i < hashes.length; i++)
    if (hexToBigInt(hashes[i - 1]) > hexToBigInt(hashes[i])) {
      fail('leaves are not in ascending leaf-hash order');
      break;
    }

  const computedRoot = valid.length && valid.length === leaves.length ? computeMerkleRoot(valid) : null;
  if (computedRoot && String(snapshot?.merkle?.root).toLowerCase() !== computedRoot.toLowerCase())
    fail(`snapshot root ${snapshot?.merkle?.root} != recomputed root ${computedRoot}`);

  if (String(total) !== String(snapshot?.totalAllocated)) fail(`sum of leaf amounts ${total} != totalAllocated ${snapshot?.totalAllocated}`);
  if (/^[0-9]+$/.test(String(snapshot?.funded)) && total > BigInt(snapshot.funded))
    fail(`allocates ${total} but the snapshot says only ${snapshot.funded} is funded`);

  // Rows carry no address, by design: compare amounts as multisets.
  const rows = Array.isArray(snapshot?.scoreboard) ? snapshot.scoreboard : [];
  const rowAmounts = rows.map((row) => String(row.amount)).sort();
  const leafAmounts = leaves.map((leaf) => String(leaf.amount)).sort();
  if (rowAmounts.join(',') !== leafAmounts.join(',')) fail(`scoreboard amounts [${rowAmounts}] do not match leaf amounts [${leafAmounts}]`);

  if (snapshot?.quest?.type === 'scoreboard') {
    const tiers = snapshot?.rules?.tiers ?? [];
    for (const row of rows) {
      if (row.place === null || row.place === undefined) {
        fail('a scoreboard row has no place');
        continue;
      }
      const place = row.place;
      const expected = tiers
        .filter((tier) => tier.startPlace !== null && tier.endPlace !== null && place >= tier.startPlace && place <= tier.endPlace)
        .reduce((sum, tier) => sum + BigInt(tier.amount), 0n);
      if (expected !== BigInt(row.amount)) fail(`place ${place} earned ${row.amount} but the tiers covering it sum to ${expected}`);
    }
    const places = rows.map((row) => row.place);
    if (new Set(places).size !== places.length) fail('two scoreboard rows share a place');
  }

  let referenceRoot: Hex | null = null;
  let referenceSource: VerifyWinnersResult['referenceSource'] = null;

  if (options.root) {
    referenceRoot = options.root;
    referenceSource = 'supplied';
    notes.push('compared against a root supplied by the caller, NOT read from the chain');
  } else {
    if (!publicClient) throw new Error('verifyWinners: pass a publicClient on the snapshot chain, or options.root for an offline check');
    const chainId = await publicClient.getChainId();
    if (chainId !== Number(snapshot.chainId)) fail(`the client is on chain ${chainId} but the snapshot is for chain ${snapshot.chainId}`);

    const escrow = getAddress(snapshot.escrow) as Address;
    const known = (PEDDLEQUEST_CHAINS as Record<number, { contracts: { escrow: Address } }>)[Number(snapshot.chainId)]?.contracts.escrow;
    if (known !== escrow) notes.push(`escrow ${escrow} is not the current PeddleQuest escrow on chain ${snapshot.chainId}${known ? ` (${known})` : ''}`);

    const pool = await publicClient.readContract({ address: escrow, abi: peddlesQuestEscrowAbi, functionName: 'questOf', args: [snapshot.questId] });
    if (!pool.finalised) fail('the escrow says this pool is NOT finalised: no root is published on chain yet');
    if (getAddress(pool.rewardToken) !== getAddress(snapshot?.asset?.token || NATIVE_ASSET))
      fail(`on-chain reward token ${pool.rewardToken} != snapshot asset ${snapshot?.asset?.token}`);
    if (pool.funded.toString() !== String(snapshot.funded)) fail(`on-chain funded ${pool.funded} != snapshot funded ${snapshot.funded}`);
    if (total > pool.funded) fail(`allocates ${total} but the escrow holds only ${pool.funded} for this pool`);
    referenceRoot = pool.merkleRoot;
    referenceSource = 'chain';
  }

  if (computedRoot && referenceRoot && referenceRoot.toLowerCase() !== computedRoot.toLowerCase())
    fail(`recomputed root ${computedRoot} != ${referenceSource === 'chain' ? 'on-chain' : 'supplied'} root ${referenceRoot}`);

  return {
    match: failures.length === 0,
    failures,
    notes,
    computedRoot,
    referenceRoot,
    referenceSource,
    totalAllocated: total,
    snapshot,
  };
};
