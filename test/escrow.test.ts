import { describe, expect, it } from 'vitest';

import { buildClaimCall, deriveEscrowQuestId, getQuestPool } from '../src/escrow';
import { getChain, PEDDLEQUEST_CHAINS } from '../src/chains';
import { derivePromotionSubject, getPromotionSlot, PromotionPlacement } from '../src/promotion';

/**
 * The five production pools created through the real creator flow on
 * 2026-10-03 (docs/monetization.md §7c; project/contract ids from
 * contracts/script/out/creator-run.plan.json). Each questId is the one the
 * escrow holds money under.
 */
const PRODUCTION_POOLS = [
  { chain: 8453, projectId: 1, contractId: 3, questId: '0xa15bc60c955c405d20d9149c709e2460f1c2d9a497496a7f46004d1772c3054c' },
  { chain: 4663, projectId: 2, contractId: 4, questId: '0x91da3fd0782e51c6b3986e9e672fd566868e71f3dbc2d6c2cd6fbb3e361af2a7' },
  { chain: 56, projectId: 3, contractId: 5, questId: '0xa9bc9a3a348c357ba16b37005d7e6b3236198c0e939f4af8c5f19b8deeb8ebc0' },
  { chain: 5042, projectId: 4, contractId: 6, questId: '0xc5069e24aaadb2addc3e52e868fcf3f4f8acf5a87e24300992fd4540c2a87eed' },
  { chain: 11155111, projectId: 5, contractId: 7, questId: '0xbcdda56b5d08466ec462cbbe0adfa57cb0a15fcc8940ef68f702f21b787bc935' },
] as const;

describe('deriveEscrowQuestId', () => {
  it.each(PRODUCTION_POOLS)('matches the live pool on chain $chain', ({ projectId, contractId, questId }) => {
    expect(deriveEscrowQuestId(projectId, contractId)).toBe(questId);
    expect(deriveEscrowQuestId(BigInt(projectId), BigInt(contractId))).toBe(questId);
  });

  it('uses 0 for a pool with no contract row (the backend sentinel)', () => {
    expect(deriveEscrowQuestId(1, null)).toBe(deriveEscrowQuestId(1, 0));
  });

  it('refuses unusable ids', () => {
    expect(() => deriveEscrowQuestId(0, 1)).toThrow();
    expect(() => deriveEscrowQuestId(1, -1)).toThrow();
    expect(() => deriveEscrowQuestId(1.5, 1)).toThrow();
  });
});

describe('chains', () => {
  it('has the same escrow on all four mainnets', () => {
    for (const id of [8453, 4663, 56, 5042]) expect(getChain(id).contracts.escrow).toBe('0x16267bE6D067b3d411bf779B5aD041f9eba4CadE');
    expect(getChain('0x2105').id).toBe(8453);
    expect(getChain('11155111').contracts.escrow).toBe('0xB55844D1ED3FACba7310137cA5F9d2ed70B1d462');
    expect(PEDDLEQUEST_CHAINS[4663].hexId).toBe('0x1237');
  });
  it('refuses a chain with no deployment', () => {
    expect(() => getChain(1)).toThrow(/no PeddleQuest deployment/);
  });
});

describe('getQuestPool', () => {
  it('reads questOf on the chain escrow and derives remaining/exists', async () => {
    const calls: unknown[] = [];
    const client = {
      readContract: async (args: unknown) => {
        calls.push(args);
        return {
          creator: '0x31fffDFc9Ec36F1340be49245E1c96F4512F679e',
          rewardToken: '0x0000000000000000000000000000000000000000',
          funded: 400000000000000n,
          claimed: 100000000000000n,
          claimsOpenAt: 0n,
          claimDeadline: 1791259824n,
          merkleRoot: '0x0000000000000000000000000000000000000000000000000000000000000000',
          finalised: false,
          swept: false,
        };
      },
    } as never;
    const pool = await getQuestPool(client, 8453, PRODUCTION_POOLS[0].questId);
    expect((calls[0] as { address: string }).address).toBe('0x16267bE6D067b3d411bf779B5aD041f9eba4CadE');
    expect((calls[0] as { functionName: string }).functionName).toBe('questOf');
    expect(pool.remaining).toBe(300000000000000n);
    expect(pool.exists).toBe(true);
    expect(typeof pool.funded).toBe('bigint');
  });
});

describe('buildClaimCall', () => {
  const proof = {
    chainId: '0x2105',
    escrowAddress: '0x16267be6d067b3d411bf779b5ad041f9eba4cade',
    questId: PRODUCTION_POOLS[0].questId,
    account: '0x31fffdfc9ec36f1340be49245e1c96f4512f679e',
    amount: '100000000000000',
    proof: ['0x' + '11'.repeat(32)],
  };

  it('builds a writeContract-ready claim with bigint amount and checksummed addresses', () => {
    const call = buildClaimCall(proof);
    expect(call.functionName).toBe('claim');
    expect(call.address).toBe('0x16267bE6D067b3d411bf779B5aD041f9eba4CadE');
    expect(call.chainId).toBe(8453);
    expect(call.args[1]).toBe('0x31fffDFc9Ec36F1340be49245E1c96F4512F679e');
    expect(call.args[2]).toBe(100000000000000n);
    expect(call.abi.some((e) => e.type === 'function' && e.name === 'claim')).toBe(true);
  });

  it('refuses a proof that names some other contract', () => {
    expect(() => buildClaimCall({ ...proof, escrowAddress: '0x000000000000000000000000000000000000dEaD' })).toThrow(/PeddleQuest escrow/);
  });

  it('refuses a non-base-unit amount', () => {
    expect(() => buildClaimCall({ ...proof, amount: '0.0001' })).toThrow();
  });
});

describe('promotion', () => {
  it('derives the subject the backend derives', () => {
    // cast keccak $(cast abi-encode "f(string,uint256)" "peddlesquest.promotion.quest" 1)
    // (reference values computed with the api's viem against subject.ts's encoding)
    expect(derivePromotionSubject(1)).toBe('0xf072dbd6f50daa103f9ab2d3441c34ca52b3d274b2b599006c5be855ed8d1ef1');
    expect(derivePromotionSubject(3)).toBe('0xe86798884eb916ffb55b3a2ec4810e36c0fd3d5aaa495e93f3210e8ba1b74216');
  });

  it('reads slotOf and isActive on the market', async () => {
    const seen: string[] = [];
    const client = {
      readContract: async ({ functionName, address }: { functionName: string; address: string }) => {
        seen.push(`${functionName}@${address}`);
        return functionName === 'slotOf'
          ? { buyer: '0x31fffDFc9Ec36F1340be49245E1c96F4512F679e', startsAt: 1n, endsAt: 2n, paid: 3n }
          : true;
      },
    } as never;
    const slot = await getPromotionSlot(client, 56, { loyaltyProjectId: 3 }, PromotionPlacement.Banner);
    expect(seen.sort()).toEqual([
      'isActive@0x704E5eA6752EbfcEDB377512b67c0138461f4849',
      'slotOf@0x704E5eA6752EbfcEDB377512b67c0138461f4849',
    ]);
    expect(slot.active).toBe(true);
    expect(slot.paid).toBe(3n);
    expect(slot.subject).toBe(derivePromotionSubject(3));
  });
});
