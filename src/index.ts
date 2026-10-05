/**
 * @peddlequest/sdk
 *
 * The PeddleQuest contracts are UNAUDITED. `PeddlesQuestEscrow` custodies
 * third-party funds; nothing in this package says or implies otherwise.
 */
export { createPeddleQuestClient, PeddleQuestApiError, DEFAULT_API_URL } from './client';
export type { PeddleQuestClient, PeddleQuestClientOptions, RequestOptions } from './client';
export type * from './types';

export {
  PEDDLEQUEST_CHAINS,
  SUPPORTED_CHAIN_IDS,
  NATIVE_ASSET,
  getChain,
  getContracts,
} from './chains';
export type { PeddleQuestChain, PeddleQuestChainId, PeddleQuestContracts } from './chains';

export { peddlesQuestEscrowAbi, peddlesPromotionMarketAbi, peddlesQuestBadgeAbi, peddlesFeeRouterAbi } from './abis';

export { deriveEscrowQuestId, getQuestPool, hasClaimed, buildClaimCall } from './escrow';
export type { QuestPool, ClaimCall } from './escrow';

export { PromotionPlacement, PROMOTION_SUBJECT_TAG, derivePromotionSubject, getPromotionSlot } from './promotion';
export type { PromotionSlot } from './promotion';

export { leafHash, hashPair, verifyMerkleProof, computeMerkleRoot } from './merkle';
export type { BaseUnits, MerkleEntry } from './merkle';

export { verifyWinners, rawCidOf, WINNER_SNAPSHOT_SCHEMA } from './winners';
export type { WinnerSnapshotV1, WinnerSnapshotRowV1, WinnerSnapshotLeafV1, VerifyWinnersOptions, VerifyWinnersResult } from './winners';

export {
  mountQuestWidget,
  mountLeaderboardWidget,
  mountLiveQuestsWidget,
  questWidgetUrl,
  leaderboardWidgetUrl,
  liveQuestsWidgetUrl,
  isWidgetResizeMessage,
  resizeFromEvent,
  WIDGET_RESIZE_MESSAGE,
  MIN_WIDGET_HEIGHT,
  MAX_WIDGET_HEIGHT,
  DEFAULT_APP_URL,
} from './embed';
export type {
  Widget,
  WidgetKind,
  WidgetTheme,
  WidgetBaseOptions,
  WidgetResizeMessage,
  QuestWidget,
  QuestWidgetOptions,
  LeaderboardWidgetOptions,
  LiveQuestsWidgetOptions,
} from './embed';
