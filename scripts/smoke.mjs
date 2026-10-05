#!/usr/bin/env node
/**
 * Live smoke test against production. Reads only: sends no transaction and
 * needs no key.
 *
 *   npm run build && node scripts/smoke.mjs [--rpc <base-rpc-url>]
 *
 * 1. lists live quests from https://api.peddlequest.xyz/api
 * 2. reads the first Base pool the API reports, with questOf on the Base escrow
 *    over a public RPC, and checks it against the API and deriveEscrowQuestId.
 */
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

import { createPeddleQuestClient, deriveEscrowQuestId, getQuestPool, getContracts } from '../dist/index.js';

const rpcIndex = process.argv.indexOf('--rpc');
const rpc = rpcIndex > 0 ? process.argv[rpcIndex + 1] : 'https://mainnet.base.org';

const api = createPeddleQuestClient();
const list = await api.listQuests();
console.log(`api: ${list.loyaltyProjects.length} live quest(s) from ${api.apiUrl}`);
for (const q of list.loyaltyProjects)
  console.log(`  - ${q.linkTitle} [${q.projectType}, ${q.status}] ${q.rewards.tokens.map((t) => `${t.amount} ${t.symbol}@${t.chainId}`).join(', ')}`);

const baseQuest = list.loyaltyProjects.find((q) => q.rewards.tokens.some((t) => t.chainId === '0x2105'));
if (!baseQuest) {
  console.log('no Base quest listed; skipping the pool read');
  process.exit(0);
}

const [pool] = (await api.getQuestEscrow(baseQuest.linkTitle)).filter((p) => p.chainId === '0x2105');
const quest = await api.getQuest(baseQuest.linkTitle);
const reward = quest.fullRewards?.rewards.find((r) => r.escrowQuestId === pool.escrowQuestId);
const derived = reward ? deriveEscrowQuestId(reward.loyaltyProjectId, reward.contractId) : null;
console.log(`api pool: ${baseQuest.linkTitle} questId ${pool.questId} funded ${pool.fundedAmount} (decimals ${pool.decimals})`);
console.log(`derived questId ${derived} ${derived === pool.questId ? 'MATCHES' : 'DIFFERS FROM'} the API`);

const client = createPublicClient({ chain: base, transport: http(rpc, { timeout: 30_000 }) });
const chain = await client.getChainId();
const onChain = await getQuestPool(client, chain, pool.questId);
console.log(`chain ${chain} escrow ${getContracts(chain).escrow} via ${rpc}:`);
console.log(`  exists ${onChain.exists} creator ${onChain.creator} token ${onChain.rewardToken}`);
console.log(`  funded ${onChain.funded} claimed ${onChain.claimed} deadline ${onChain.claimDeadline} finalised ${onChain.finalised} root ${onChain.merkleRoot}`);
const agrees = onChain.funded.toString() === pool.fundedAmount;
console.log(`funded on chain ${agrees ? 'MATCHES' : 'DIFFERS FROM'} the API`);
process.exit(agrees && derived === pool.questId ? 0 : 1);
