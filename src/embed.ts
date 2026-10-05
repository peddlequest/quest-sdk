/**
 * The PeddleQuest widgets, framework-free.
 *
 * Each `mount*Widget` appends an iframe of one of the app's embed routes:
 *
 *   quest        /iframe/<linkTitle>               the read-only quest card
 *   leaderboard  /widget/leaderboard/<linkTitle>   the quest's top N
 *   live quests  /widget/quests?project=|chain=    a project's or chain's live quests
 *
 * Every widget is read-only, anonymous (it never claims progress) and opens
 * its links in the top window. A `ref` option is passed through to the quest
 * links untouched, for share-to-earn attribution.
 *
 * Auto-height: the embed posts `{ type: 'peddlequest:resize', height, widget,
 * id }` to its parent whenever its content changes height. The listener here
 * accepts a message only when `event.source` is THIS iframe's window and the
 * origin is the app's, and then sets the frame's height. Pass
 * `autoHeight: false` to keep a fixed height; calling `setHeight` also turns
 * auto-height off, so a manual size is never overwritten.
 */

export const DEFAULT_APP_URL = 'https://peddlequest.xyz';

/** `type` of the message the embeds post to their parent. */
export const WIDGET_RESIZE_MESSAGE = 'peddlequest:resize';

export type WidgetKind = 'quest' | 'leaderboard' | 'live-quests';
export type WidgetTheme = 'dark' | 'light';

export interface WidgetResizeMessage {
  type: typeof WIDGET_RESIZE_MESSAGE;
  /** CSS pixels. */
  height: number;
  widget: WidgetKind;
  /** The id from the widget's URL: a quest link, or `project:<slug>` / `chain:<hex>` / `all`. */
  id: string;
}

/** Heights outside this range are ignored, not clamped: they are not a real card. */
export const MIN_WIDGET_HEIGHT = 40;
export const MAX_WIDGET_HEIGHT = 10_000;

const KINDS: readonly WidgetKind[] = ['quest', 'leaderboard', 'live-quests'];

/** True when `data` is a well-formed resize message. Pure; no DOM. */
export const isWidgetResizeMessage = (data: unknown): data is WidgetResizeMessage => {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return (
    m.type === WIDGET_RESIZE_MESSAGE &&
    typeof m.height === 'number' &&
    Number.isFinite(m.height) &&
    m.height >= MIN_WIDGET_HEIGHT &&
    m.height <= MAX_WIDGET_HEIGHT &&
    typeof m.widget === 'string' &&
    (KINDS as readonly string[]).includes(m.widget) &&
    typeof m.id === 'string'
  );
};

/** Shared options for every widget. */
export interface WidgetBaseOptions {
  /** Default `'dark'`. Passed to the embed as `?theme=` and used for the frame's `color-scheme`. */
  theme?: WidgetTheme;
  /** Initial height in pixels, before the first resize message. */
  height?: number;
  /** Follow the embed's reported height. Default `true`. */
  autoHeight?: boolean;
  /** CSS max-width of the frame. The frame is otherwise `width: 100%`. */
  maxWidth?: string;
  /** Accessible title of the iframe. */
  title?: string;
  /** Referral code passed through to the quest links as `?ref=`. */
  ref?: string;
  /** Default `https://peddlequest.xyz`. */
  appUrl?: string;
}

export interface QuestWidgetOptions extends WidgetBaseOptions {
  /** The quest's link (last segment of `https://peddlequest.xyz/quest/<linkTitle>`). */
  linkTitle: string;
}

export interface LeaderboardWidgetOptions extends WidgetBaseOptions {
  /** The quest's link. */
  linkTitle: string;
  /** Rows to show, 1-25. Default 10 (the embed's default). */
  limit?: number;
}

export interface LiveQuestsWidgetOptions extends WidgetBaseOptions {
  /** A partner project's slug (`https://peddlequest.xyz/partners/<slug>`). */
  project?: string;
  /** `base`, `bsc`, `arc`, `robinhood`, or a chain id (`8453`, `0x2105`). Mainnets only. */
  chain?: string | number;
  /** Rows to show, 1-20. Default 5 (the embed's default). */
  limit?: number;
}

export interface Widget {
  iframe: HTMLIFrameElement;
  /** Set a fixed height and stop following resize messages. */
  setHeight(px: number): void;
  /** Remove the frame and its message listener. */
  destroy(): void;
}

/** Kept for 0.1 callers: the quest widget's handle. */
export type QuestWidget = Widget;

/* ── URLs ─────────────────────────────────────────────────────────────── */

const base = (appUrl: string | undefined): string => (appUrl ?? DEFAULT_APP_URL).replace(/\/+$/, '');

const requireLink = (linkTitle: unknown): string => {
  if (!linkTitle || typeof linkTitle !== 'string') throw new Error('peddlequest: linkTitle is required');
  return linkTitle;
};

const query = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

const limitOf = (limit: number | undefined): number | undefined => {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`peddlequest: limit ${limit} is not a positive integer`);
  return limit;
};

type UrlOptions = Pick<WidgetBaseOptions, 'appUrl' | 'theme' | 'ref'>;

/**
 * The URL `mountQuestWidget` frames. Useful for server-rendered HTML.
 * The 0.1 form `questWidgetUrl(linkTitle, appUrl)` still works.
 */
export const questWidgetUrl = (linkTitle: string, options: string | UrlOptions = {}): string => {
  const opts: UrlOptions = typeof options === 'string' ? { appUrl: options } : options;
  return `${base(opts.appUrl)}/iframe/${encodeURIComponent(requireLink(linkTitle))}${query({ theme: opts.theme, ref: opts.ref })}`;
};

export const leaderboardWidgetUrl = (linkTitle: string, options: UrlOptions & { limit?: number } = {}): string =>
  `${base(options.appUrl)}/widget/leaderboard/${encodeURIComponent(requireLink(linkTitle))}${query({
    theme: options.theme,
    limit: limitOf(options.limit),
    ref: options.ref,
  })}`;

export const liveQuestsWidgetUrl = (options: UrlOptions & { project?: string; chain?: string | number; limit?: number } = {}): string => {
  if (options.project && options.chain !== undefined) {
    throw new Error('peddlequest: pass project or chain, not both');
  }
  return `${base(options.appUrl)}/widget/quests${query({
    project: options.project,
    chain: options.chain === undefined ? undefined : String(options.chain),
    theme: options.theme,
    limit: limitOf(options.limit),
    ref: options.ref,
  })}`;
};

/* ── mounting ─────────────────────────────────────────────────────────── */

const LOADING_BG = { dark: '#05080f', light: '#f3f6fb' } as const;

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Whether a `message` event is a resize from `iframe`. Exported for hosts
 * that build their own frame: check the source window, then the origin,
 * then the shape.
 */
export const resizeFromEvent = (
  event: { source?: unknown; origin?: string; data?: unknown },
  iframe: { contentWindow: unknown },
  expectedOrigin: string | null,
): WidgetResizeMessage | null => {
  if (!iframe.contentWindow || event.source !== iframe.contentWindow) return null;
  if (expectedOrigin && event.origin !== expectedOrigin) return null;
  return isWidgetResizeMessage(event.data) ? event.data : null;
};

const mountFrame = (
  el: Element | string,
  src: string,
  options: WidgetBaseOptions,
  defaults: { height: number; maxWidth: string; title: string },
): Widget => {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('peddlequest: widgets need a DOM (call mount* in the browser)');
  }
  const host = typeof el === 'string' ? document.querySelector(el) : el;
  if (!host) throw new Error(`peddlequest: no element matches ${String(el)}`);

  const theme: WidgetTheme = options.theme === 'light' ? 'light' : 'dark';
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = options.title ?? defaults.title;
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  Object.assign(iframe.style, {
    display: 'block',
    width: '100%',
    maxWidth: options.maxWidth ?? defaults.maxWidth,
    height: `${options.height ?? defaults.height}px`,
    border: '0',
    borderRadius: '12px',
    colorScheme: theme,
    background: LOADING_BG[theme],
  });

  let auto = options.autoHeight !== false;
  const expectedOrigin = originOf(src);
  const onMessage = (event: MessageEvent) => {
    if (!auto) return;
    const message = resizeFromEvent(event, iframe, expectedOrigin);
    if (message) iframe.style.height = `${Math.ceil(message.height)}px`;
  };
  window.addEventListener('message', onMessage);

  host.appendChild(iframe);

  return {
    iframe,
    setHeight(px: number) {
      if (!Number.isFinite(px) || px <= 0) throw new Error(`peddlequest: height ${px} is not a positive number`);
      auto = false;
      iframe.style.height = `${Math.round(px)}px`;
    },
    destroy() {
      window.removeEventListener('message', onMessage);
      iframe.remove();
    },
  };
};

/**
 * Append the quest card to `el` (an element or a CSS selector). Browser only.
 * The card's "Join quest" button opens the quest in the top window, with
 * `ref` passed through when given.
 */
export const mountQuestWidget = (el: Element | string, options: QuestWidgetOptions): Widget =>
  mountFrame(el, questWidgetUrl(options.linkTitle, { appUrl: options.appUrl, theme: options.theme ?? 'dark', ref: options.ref }), options, {
    height: 520,
    maxWidth: '360px',
    title: `${options.linkTitle} on PeddleQuest`,
  });

/** Append a quest's leaderboard (top `limit` places) to `el`. Browser only. */
export const mountLeaderboardWidget = (el: Element | string, options: LeaderboardWidgetOptions): Widget =>
  mountFrame(
    el,
    leaderboardWidgetUrl(options.linkTitle, { appUrl: options.appUrl, theme: options.theme ?? 'dark', ref: options.ref, limit: options.limit }),
    options,
    { height: 480, maxWidth: '400px', title: `${options.linkTitle} leaderboard on PeddleQuest` },
  );

/** Append a project's or a chain's live quests to `el`. Browser only. */
export const mountLiveQuestsWidget = (el: Element | string, options: LiveQuestsWidgetOptions = {}): Widget =>
  mountFrame(
    el,
    liveQuestsWidgetUrl({
      appUrl: options.appUrl,
      theme: options.theme ?? 'dark',
      ref: options.ref,
      limit: options.limit,
      project: options.project,
      chain: options.chain,
    }),
    options,
    { height: 420, maxWidth: '400px', title: 'Live quests on PeddleQuest' },
  );
