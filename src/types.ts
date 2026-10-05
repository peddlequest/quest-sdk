/**
 * Response shapes of the PeddleQuest public API, taken from the route handlers
 * in api/src/server/routes and confirmed against https://api.peddlequest.xyz/api
 * on 2026-10-03 (recorded under test/fixtures).
 *
 * Fields the API does not always send are optional; fields it sends as `null`
 * are typed `| null`. An index signature is deliberately absent, but the API
 * may add fields - treat these as a floor, not a ceiling.
 *
 * MONEY: `rewards.tokens[].amount` and `fullRewards.rewards[].amount` are
 * human-unit display figures that the API serialises as JSON numbers (it
 * stores them that way). They are for showing, never for arithmetic. Every
 * on-chain amount (`grossAmount`, `fundedAmount`, proof `amount`) is a
 * base-unit decimal string and travels with its `decimals`.
 */

/** API chain ids are lowercase hex strings, e.g. `0x2105` (Base). */
export type HexChainId = string;

export type QuestType = 'scoreboard' | 'guaranteed' | 'luckyDraw' | (string & {});
export type QuestStatus = 'Draft' | 'Active' | (string & {});
export type QuestTimeStatus = 'soon' | 'active' | 'expired' | 'participating' | (string & {});

export interface PartnerProjectRef {
  logo?: string | null;
  name: string;
  linkTitle?: string | null;
  verificationIcon: boolean;
}

export interface RewardTokenSummary {
  logo?: string | null;
  type?: string;
  /** Human units, display only. See the MONEY note at the top of this file. */
  amount: number;
  symbol: string;
  chainId?: HexChainId | null;
}

export interface QuestRewardsSummary {
  whitelisting?: boolean;
  tokens: RewardTokenSummary[];
}

/** One card in `GET /loyalty-projects`. */
export interface QuestSummary {
  id: number;
  linkTitle: string;
  title: string;
  partnerProjects: PartnerProjectRef[];
  tasksCount?: { tasksDone: number; totalTasks: number };
  status: QuestTimeStatus;
  startAt: string | null;
  endAt: string | null;
  rewards: QuestRewardsSummary;
  projectType: QuestType;
  preview_img?: string | null;
  questStatus?: QuestStatus;
  totalExp?: number | null;
  isWhitebit?: boolean;
}

export interface QuestList {
  loyaltyProjects: QuestSummary[];
  isShowMore: boolean;
  projectsTitle?: string[];
  searchCount?: number | null;
}

/**
 * Query of `GET /loyalty-projects` (api/src/server/helpers/routerHelpers.ts
 * `getFilterOptions`). Lists are comma-joined by the client; members outside
 * the enum are dropped by the API, except `chainIds`, which 400s.
 */
export interface ListQuestsParams {
  campaign?: ('trending' | 'newest')[];
  reward?: ('token' | 'nft' | 'whitelist')[];
  status?: ('soon' | 'expired' | 'participating' | 'active')[];
  /** Partner project linkTitle (slug). */
  partner?: string;
  /** API default true. */
  visible?: boolean;
  featured?: boolean;
  trending?: boolean;
  /** API default true. */
  paginate?: boolean;
  full?: boolean;
  /** 1-based. */
  page?: number;
  search?: string;
  suggested?: boolean;
  /** linkTitle to exclude, used with `suggested`. */
  current?: string;
  /** Hex chain ids, e.g. `['0x2105', '0x38']`. */
  chainIds?: HexChainId[];
}

export interface QuestTask {
  id: number;
  /** Task type, e.g. `visitLink`, `quiz`, `followTwitter`, `invite`, `peddlesHold`. */
  type: string;
  title: string;
  /** Type-specific settings. Never contains a quiz's answers. */
  body: Record<string, unknown>;
  points: number;
  expPoints?: number;
  status?: string;
  required?: boolean;
  sortOrder?: number;
  startAt?: string | null;
  endAt?: string | null;
  isOnboardingTask?: boolean;
}

export interface RewardContract {
  id: number;
  name: string;
  symbol: string;
  logo?: string | null;
  chainId: HexChainId;
  isVerified?: boolean;
  /** Zero address = native coin. */
  address: string;
  standard?: string | null;
  /** Never assume 18. */
  decimals: number | null;
  type?: string;
}

export interface QuestReward {
  id: number;
  /** Human units, display only. */
  amount: number;
  description?: string | null;
  startPlace?: number | null;
  endPlace?: number | null;
  loyaltyProjectId: number;
  /** Input to `deriveEscrowQuestId(loyaltyProjectId, contractId)`. */
  contractId: number | null;
  /** `escrow` for a pool held in PeddlesQuestEscrow. */
  settlement?: string | null;
  escrowQuestId?: number | null;
  contract?: RewardContract | null;
  tokenType?: string;
  isClaimable?: boolean;
  verified?: boolean;
}

/** `GET /loyalty-project/:link`. */
export interface QuestDetail {
  id: number;
  linkTitle: string;
  title: string;
  partnerProjects: PartnerProjectRef[];
  status: QuestTimeStatus;
  projectType: QuestType;
  rewards: QuestRewardsSummary;
  startAt: string | null;
  endAt: string | null;
  claimingStartAt?: string | null;
  claimingEndAt?: string | null;
  /** HTML authored by the quest creator. Sanitise before rendering. */
  description?: string | null;
  socialDescription?: string | null;
  loyaltyTasks: QuestTask[];
  preview_img?: string | null;
  eligibleUsersCount?: number | null;
  threshold?: number | string | null;
  participants?: number;
  questStatus?: QuestStatus;
  isWhitebit?: boolean;
  fullRewards?: { rewards: QuestReward[] };
  metadata?: Record<string, unknown> | null;
}

/**
 * One scoreboard row. `wallet` is the column's historical name: it carries the
 * USERNAME (or `default_<id>`), never a wallet address - leaderboards do not
 * publish wallets. `place` and `earnedPoints` come from SQL aggregates and may
 * arrive as numbers or numeric strings.
 */
export interface ScoreboardRow {
  id: number | string;
  place: number | string;
  wallet: string;
  earnedPoints: number | string;
  status?: string;
}

export interface Scoreboard {
  scoreboard: ScoreboardRow[];
  /** Present only for a signed-in caller who is on the board. */
  userInfo?: ScoreboardRow | null;
  page: number;
  pageSize: number;
  total: number;
  luckyDrawWinnersCount?: number | null;
  eligibleUsersCount?: number | null;
}

export type EscrowPhase = string;

/** One pool from `GET /loyalty-project/:link/escrow`. */
export interface EscrowPool {
  finalisation: { phase: EscrowPhase; automatic: boolean; [key: string]: unknown };
  escrowQuestId: number;
  chainId: HexChainId;
  escrowAddress: string;
  /** bytes32 pool id; the authority for this pool. */
  questId: string;
  rewardToken: string;
  decimals: number;
  /** Base units, decimal string. */
  grossAmount: string;
  /** Base units, decimal string. */
  fundedAmount: string | null;
  claimsOpenAt: string | null;
  claimDeadline: string | null;
  merkleRoot: string | null;
  /** IPFS CID of the winner snapshot; null if not (yet) published. */
  winnerSnapshotCid?: string | null;
  winnerSnapshotUrl?: string | null;
  status: string;
}

export interface ActivePromotion {
  loyaltyProjectId: number;
  linkTitle: string | null;
  placement: 'trending' | 'banner';
  chainId: HexChainId;
  market: string;
  subject: string;
  buyer: string;
  /** Unix seconds, string. */
  startsAt: string;
  endsAt: string;
}

/** `GET /promotion/active` (`data`). A chain with `ok: false` contributed nothing. */
export interface ActivePromotions {
  placements: ActivePromotion[];
  chains: { chainId: HexChainId; ok: boolean; blockNumber: string | null }[];
  checkedAt: string;
}

export interface RewardAsset {
  /** Zero address = native coin. */
  address: string;
  symbol: string;
  /** Null for native (the chain's native decimals apply). */
  decimals: number | null;
}

/** `GET /escrow/reward-assets` (`data`). */
export interface RewardAssets {
  chains: {
    chainId: HexChainId;
    escrowConfigured: boolean;
    assets: RewardAsset[];
    /** Token address -> minimum pool, base units. */
    minPoolBaseUnits: Record<string, string>;
  }[];
}

/** One proof from `GET /loyalty-project/:link/claim/proof` (signed-in; `data[]`). */
export interface EscrowProof {
  escrowQuestId: number;
  chainId: HexChainId;
  escrowAddress: string;
  questId: string;
  /** The only address this leaf pays. */
  account: string;
  /** Base units, decimal string. */
  amount: string;
  proof: string[];
  merkleRoot: string;
  claimsOpenAt: string | null;
  claimDeadline: string | null;
  hasClaimed: boolean;
  claimTxHash: string | null;
}

/** Why `claim/proof` 404'd. */
export type ProofUnavailableReason =
  | 'not_a_winner'
  | 'not_finalised'
  | 'wallet_mismatch'
  | 'no_wallet'
  | 'not_escrow_routed'
  | (string & {});
