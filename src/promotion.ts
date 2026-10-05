import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex, type PublicClient } from 'viem';

import { peddlesPromotionMarketAbi } from './abis';
import { getContracts } from './chains';

/**
 * `PeddlesPromotionMarket.Placement`, in declaration order (docs/promotion.md).
 */
export const PromotionPlacement = { Trending: 0, Banner: 1 } as const;
export type PromotionPlacement = (typeof PromotionPlacement)[keyof typeof PromotionPlacement];

export const PROMOTION_SUBJECT_TAG = 'peddlesquest.promotion.quest';

/**
 * A quest's slot key: `keccak256(abi.encode(string "peddlesquest.promotion.quest", uint256 loyaltyProjectId))`.
 * Byte-for-byte the backend's api/src/server/services/promotion/subject.ts.
 */
export const derivePromotionSubject = (loyaltyProjectId: number | bigint): Hex => {
  const id = BigInt(loyaltyProjectId);
  if (id <= 0n) throw new Error(`promotion: loyaltyProjectId ${loyaltyProjectId} is not a usable id`);
  return keccak256(encodeAbiParameters([{ type: 'string' }, { type: 'uint256' }], [PROMOTION_SUBJECT_TAG, id]));
};

export interface PromotionSlot {
  subject: Hex;
  placement: PromotionPlacement;
  /** Zero address when the slot has never been bought. */
  buyer: Address;
  /** Unix seconds. */
  startsAt: bigint;
  endsAt: bigint;
  /** Native base units paid for the slot. */
  paid: bigint;
  /** `isActive(subject, placement)` at the same block. */
  active: boolean;
}

/**
 * Read one quest's slot: `slotOf` + `isActive` on the chain's market. Pass a
 * `loyaltyProjectId` (derives the subject) or a raw `subject`.
 */
export const getPromotionSlot = async (
  publicClient: Pick<PublicClient, 'readContract'>,
  chainId: number | string,
  target: { loyaltyProjectId: number | bigint } | { subject: Hex },
  placement: PromotionPlacement,
  options: { market?: Address } = {},
): Promise<PromotionSlot> => {
  const address = options.market ? getAddress(options.market) : getContracts(chainId).promotionMarket;
  const subject = 'subject' in target ? target.subject : derivePromotionSubject(target.loyaltyProjectId);
  const [slot, active] = await Promise.all([
    publicClient.readContract({ address, abi: peddlesPromotionMarketAbi, functionName: 'slotOf', args: [subject, placement] }),
    publicClient.readContract({ address, abi: peddlesPromotionMarketAbi, functionName: 'isActive', args: [subject, placement] }),
  ]);
  return {
    subject,
    placement,
    buyer: slot.buyer,
    startsAt: BigInt(slot.startsAt),
    endsAt: BigInt(slot.endsAt),
    paid: slot.paid,
    active,
  };
};
