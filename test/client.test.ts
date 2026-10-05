import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPeddleQuestClient, PeddleQuestApiError } from '../src/client';
import { deriveEscrowQuestId } from '../src/escrow';
import { questWidgetUrl } from '../src/embed';

/** Responses recorded from https://api.peddlequest.xyz/api on 2026-10-03. */
const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

const ROUTES: Record<string, { status: number; body: string }> = {
  '/loyalty-projects': { status: 200, body: fixture('loyalty-projects.json') },
  '/loyalty-project/base-launch-run-quest': { status: 200, body: fixture('loyalty-project.json') },
  '/loyalty-project/base-launch-run-quest/scoreboard': { status: 200, body: fixture('scoreboard.json') },
  '/loyalty-project/base-launch-run-quest/escrow': { status: 200, body: fixture('escrow.json') },
  '/loyalty-project/nope-xyz': { status: 404, body: fixture('not-found.json') },
  '/promotion/active': { status: 200, body: fixture('promotion-active.json') },
  '/escrow/reward-assets': { status: 200, body: fixture('reward-assets.json') },
  '/loyalty-project/base-launch-run-quest/claim/proof': {
    status: 404,
    body: JSON.stringify({ success: false, reason: 'not_finalised', detail: 'The winners root for this quest has not been published yet' }),
  },
};

const recorded = () => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    requests.push({ url, headers: init?.headers ?? {} });
    const path = new URL(url).pathname.replace(/^\/api/, '');
    const route = ROUTES[path] ?? { status: 404, body: '{"message":"no fixture"}' };
    return { ok: route.status < 400, status: route.status, json: async () => JSON.parse(route.body), text: async () => route.body };
  };
  return { requests, client: createPeddleQuestClient({ fetch }) };
};

describe('createPeddleQuestClient', () => {
  it('lists quests and serialises the query like the API expects', async () => {
    const { client, requests } = recorded();
    const list = await client.listQuests({ status: ['active', 'soon'], chainIds: ['0x2105', '0x38'], page: 2, search: 'base run' });
    expect(requests[0].url).toBe(
      'https://api.peddlequest.xyz/api/loyalty-projects?status=active%2Csoon&chainIds=0x2105%2C0x38&page=2&search=base+run',
    );
    expect(list.loyaltyProjects).toHaveLength(5);
    expect(list.loyaltyProjects[0].linkTitle).toBe('base-launch-run-quest');
    expect(list.isShowMore).toBe(false);
  });

  it('gets a quest, its tasks, and the reward contract id the pool id derives from', async () => {
    const { client } = recorded();
    const quest = await client.getQuest('base-launch-run-quest');
    expect(quest.id).toBe(1);
    const reward = quest.fullRewards!.rewards[0];
    expect(deriveEscrowQuestId(reward.loyaltyProjectId, reward.contractId)).toBe(
      '0xa15bc60c955c405d20d9149c709e2460f1c2d9a497496a7f46004d1772c3054c',
    );
    const tasks = await client.getQuestTasks('base-launch-run-quest');
    expect(tasks.map((t) => t.type)).toEqual(['invite', 'visitLink', 'quiz', 'followTwitter']);
  });

  it('reads the scoreboard, the escrow pools, promotions and reward assets', async () => {
    const { client } = recorded();
    const board = await client.getScoreboard('base-launch-run-quest');
    expect(board).toMatchObject({ page: 1, pageSize: 25, total: 0 });

    const pools = await client.getQuestEscrow('base-launch-run-quest');
    expect(pools[0].questId).toBe('0xa15bc60c955c405d20d9149c709e2460f1c2d9a497496a7f46004d1772c3054c');
    expect(typeof pools[0].fundedAmount).toBe('string');

    const promos = await client.getActivePromotions();
    expect(Array.isArray(promos.placements)).toBe(true);
    expect(promos.chains.find((c) => c.chainId === '0x2105')?.ok).toBe(true);

    const assets = await client.getRewardAssets();
    const base = assets.chains.find((c) => c.chainId === '0x2105')!;
    expect(base.assets.map((a) => a.symbol)).toContain('USDC');
  });

  it('throws PeddleQuestApiError with status and errorCode on a 404', async () => {
    const { client } = recorded();
    const error = await client.getQuest('nope-xyz').catch((e) => e);
    expect(error).toBeInstanceOf(PeddleQuestApiError);
    expect(error.status).toBe(404);
    expect(error.errorCode).toBe(7000);
  });

  it('sends the bearer token for claim proofs and surfaces the reason', async () => {
    const { client, requests } = recorded();
    const error = await client.getClaimProofs('base-launch-run-quest', { token: 'T' }).catch((e) => e);
    expect(requests[0].headers.authorization).toBe('Bearer T');
    expect(error.reason).toBe('not_finalised');
  });

  it('honours apiUrl and encodes the link', async () => {
    const urls: string[] = [];
    const client = createPeddleQuestClient({
      apiUrl: 'http://localhost:3010/api/',
      fetch: async (url) => {
        urls.push(url);
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      },
    });
    await client.getQuest('a b');
    expect(urls[0]).toBe('http://localhost:3010/api/loyalty-project/a%20b');
  });
});

describe('embed url', () => {
  it('frames the existing /iframe route', () => {
    expect(questWidgetUrl('base-launch-run-quest')).toBe('https://peddlequest.xyz/iframe/base-launch-run-quest');
  });
});
