import type {
  ActivePromotions,
  EscrowPool,
  EscrowProof,
  ListQuestsParams,
  ProofUnavailableReason,
  QuestDetail,
  QuestList,
  QuestTask,
  RewardAssets,
  Scoreboard,
} from './types';

export const DEFAULT_API_URL = 'https://api.peddlequest.xyz/api';

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface PeddleQuestClientOptions {
  /** Default `https://api.peddlequest.xyz/api`. */
  apiUrl?: string;
  /** Defaults to the global `fetch` (Node 18+, browsers). */
  fetch?: FetchLike;
  /** Extra headers on every request (e.g. `language: 'uk'` for localized quest text). */
  headers?: Record<string, string>;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

/** A non-2xx answer from the API, with its machine-readable fields when present. */
export class PeddleQuestApiError extends Error {
  readonly status: number;
  readonly errorCode?: number;
  /** Set for `claim/proof` 404s: why there is no proof. */
  readonly reason?: ProofUnavailableReason;
  readonly body: unknown;

  constructor(status: number, path: string, body: unknown) {
    const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : typeof record.detail === 'string' ? record.detail : `HTTP ${status}`;
    super(`peddlequest api ${path}: ${message}`);
    this.name = 'PeddleQuestApiError';
    this.status = status;
    this.errorCode = typeof record.errorCode === 'number' ? record.errorCode : undefined;
    this.reason = typeof record.reason === 'string' ? record.reason : undefined;
    this.body = body;
  }
}

const toQuery = (params: ListQuestsParams): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(','));
    } else search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

const link = (linkTitle: string): string => {
  if (!linkTitle || typeof linkTitle !== 'string') throw new Error('peddlequest: linkTitle is required');
  return encodeURIComponent(linkTitle);
};

/**
 * Typed reads over the PeddleQuest public API. Read-only: nothing here signs,
 * sends a transaction, or needs a key. `getClaimProofs` is the one method that
 * needs a signed-in user's token, because a proof is served only to its winner.
 */
export const createPeddleQuestClient = (options: PeddleQuestClientOptions = {}) => {
  const base = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
  const fetchImpl: FetchLike | undefined = options.fetch ?? (globalThis as { fetch?: FetchLike }).fetch;
  if (!fetchImpl) throw new Error('peddlequest: no fetch available; pass `fetch` in the client options');

  const get = async <T>(path: string, init: RequestOptions & { headers?: Record<string, string> } = {}): Promise<T> => {
    const response = await fetchImpl(`${base}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json', ...options.headers, ...init.headers },
      signal: init.signal,
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body: kept as text on the error */
    }
    if (!response.ok) throw new PeddleQuestApiError(response.status, path, body);
    return body as T;
  };

  /** Envelope `{ success, data }` used by the newer routes. */
  const data = async <T>(path: string, init?: RequestOptions & { headers?: Record<string, string> }): Promise<T> =>
    (await get<{ success: boolean; data: T }>(path, init)).data;

  return {
    apiUrl: base,

    /** `GET /loyalty-projects` - published quests, newest first, paginated by the API. */
    listQuests: (params: ListQuestsParams = {}, init?: RequestOptions) => get<QuestList>(`/loyalty-projects${toQuery(params)}`, init),

    /** `GET /loyalty-project/:link`. 404 (`PeddleQuestApiError`, status 404) for a missing or unpublished quest. */
    getQuest: (linkTitle: string, init?: RequestOptions) => get<QuestDetail>(`/loyalty-project/${link(linkTitle)}`, init),

    /** The quest's tasks (`loyaltyTasks` of `getQuest`), ordered by `sortOrder`. */
    getQuestTasks: async (linkTitle: string, init?: RequestOptions): Promise<QuestTask[]> => {
      const quest = await get<QuestDetail>(`/loyalty-project/${link(linkTitle)}`, init);
      return [...(quest.loyaltyTasks ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id);
    },

    /** `GET /loyalty-project/:link/scoreboard` - the leaderboard. API defaults: page 1, pageSize 25. */
    getScoreboard: (linkTitle: string, params: { page?: number; pageSize?: number } = {}, init?: RequestOptions) =>
      get<Scoreboard>(`/loyalty-project/${link(linkTitle)}/scoreboard${toQuery(params as ListQuestsParams)}`, init),

    /** `GET /loyalty-project/:link/escrow` - the quest's escrow pools, with base-unit amounts and the winner snapshot link. */
    getQuestEscrow: (linkTitle: string, init?: RequestOptions) => data<EscrowPool[]>(`/loyalty-project/${link(linkTitle)}/escrow`, init),

    /** `GET /promotion/active` - paid Trending/Banner placements, read live from each chain's market. */
    getActivePromotions: (init?: RequestOptions) => data<ActivePromotions>('/promotion/active', init),

    /** `GET /escrow/reward-assets` - the assets a quest may be funded in, per chain. */
    getRewardAssets: (init?: RequestOptions) => data<RewardAssets>('/escrow/reward-assets', init),

    /**
     * `GET /loyalty-project/:link/claim/proof` - the signed-in winner's proofs,
     * one per pool. Needs that user's PeddleQuest session token. A 404 throws
     * `PeddleQuestApiError` with `reason` (`not_a_winner`, `not_finalised`,
     * `wallet_mismatch`, `no_wallet`, `not_escrow_routed`).
     */
    getClaimProofs: (linkTitle: string, auth: { token: string }, init?: RequestOptions) =>
      data<EscrowProof[]>(`/loyalty-project/${link(linkTitle)}/claim/proof`, {
        ...init,
        headers: { authorization: `Bearer ${auth.token}` },
      }),
  };
};

export type PeddleQuestClient = ReturnType<typeof createPeddleQuestClient>;
