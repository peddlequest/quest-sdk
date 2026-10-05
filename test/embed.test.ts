import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  isWidgetResizeMessage,
  leaderboardWidgetUrl,
  liveQuestsWidgetUrl,
  mountLeaderboardWidget,
  mountLiveQuestsWidget,
  mountQuestWidget,
  questWidgetUrl,
  resizeFromEvent,
  WIDGET_RESIZE_MESSAGE,
} from '../src/embed';

/* ── a DOM just big enough for the mount functions and widget.js ─────── */

class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly style: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  contentWindow: object | null = null;
  src = '';
  title = '';
  loading = '';
  referrerPolicy = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
  }

  private adopt(child: FakeElement) {
    child.parentNode = this;
    // A connected iframe has a window; each one is a distinct object.
    if (child.tagName === 'IFRAME') child.contentWindow = { frame: child.src };
  }

  appendChild(child: FakeElement) {
    this.adopt(child);
    this.children.push(child);
    return child;
  }

  insertBefore(child: FakeElement, ref: FakeElement | null) {
    this.adopt(child);
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(child);
    else this.children.splice(at, 0, child);
    return child;
  }

  get nextSibling(): FakeElement | null {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
    this.contentWindow = null;
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  /** Supports `[attr]`, `[attr],[attr]` and `#id` only. */
  querySelectorAll(selector: string): FakeElement[] {
    const tests = selector.split(',').map((part) => {
      const s = part.trim();
      if (s.startsWith('#')) return (el: FakeElement) => el.getAttribute('id') === s.slice(1);
      const attr = /^\[([^\]=]+)\]$/.exec(s)?.[1];
      if (!attr) throw new Error(`fake DOM: unsupported selector ${s}`);
      return (el: FakeElement) => el.getAttribute(attr) !== null;
    });
    return this.descendants().filter((el) => tests.some((t) => t(el)));
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

type Listener = (event: unknown) => void;

const fakeEnvironment = () => {
  const body = new FakeElement('body');
  const listeners = new Map<string, Set<Listener>>();
  const window = {
    location: { href: 'https://host.example/page' },
    addEventListener(type: string, fn: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, event: unknown) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  } as Record<string, unknown> & {
    dispatch(type: string, event: unknown): void;
    count(type: string): number;
  };
  const document = {
    body,
    readyState: 'complete',
    currentScript: null as FakeElement | null,
    createElement: (tag: string) => new FakeElement(tag),
    querySelector: (s: string) => body.querySelector(s),
    querySelectorAll: (s: string) => body.querySelectorAll(s),
    addEventListener() {},
  };
  return { window, document, body };
};

const resize = (height: number, widget = 'quest', id = 'q') => ({ type: WIDGET_RESIZE_MESSAGE, height, widget, id });

/* ── URLs ─────────────────────────────────────────────────────────────── */

describe('widget urls', () => {
  it('keeps the 0.1 questWidgetUrl forms', () => {
    expect(questWidgetUrl('base-launch-run-quest')).toBe('https://peddlequest.xyz/iframe/base-launch-run-quest');
    expect(questWidgetUrl('a b', 'http://localhost:3001/')).toBe('http://localhost:3001/iframe/a%20b');
  });

  it('adds theme and passes ref through encoded, with no utm', () => {
    const url = questWidgetUrl('q', { theme: 'light', ref: 'ab c&d' });
    expect(url).toBe('https://peddlequest.xyz/iframe/q?theme=light&ref=ab+c%26d');
    expect(new URL(url).searchParams.get('ref')).toBe('ab c&d');
    expect(url).not.toMatch(/utm_/);
  });

  it('builds the leaderboard url', () => {
    expect(leaderboardWidgetUrl('base-launch-run-quest', { limit: 5, theme: 'dark' })).toBe(
      'https://peddlequest.xyz/widget/leaderboard/base-launch-run-quest?theme=dark&limit=5',
    );
    expect(() => leaderboardWidgetUrl('q', { limit: 0 })).toThrow(/limit/);
    expect(() => leaderboardWidgetUrl('')).toThrow(/linkTitle/);
  });

  it('builds the live-quests url for a project, a chain or everything', () => {
    expect(liveQuestsWidgetUrl({ project: 'northwind' })).toBe('https://peddlequest.xyz/widget/quests?project=northwind');
    expect(liveQuestsWidgetUrl({ chain: 8453, limit: 3 })).toBe('https://peddlequest.xyz/widget/quests?chain=8453&limit=3');
    expect(liveQuestsWidgetUrl()).toBe('https://peddlequest.xyz/widget/quests');
    expect(() => liveQuestsWidgetUrl({ project: 'a', chain: 'base' })).toThrow(/not both/);
  });
});

/* ── message filtering ────────────────────────────────────────────────── */

describe('resize messages', () => {
  it('accepts only the documented shape', () => {
    expect(isWidgetResizeMessage(resize(612))).toBe(true);
    expect(isWidgetResizeMessage(resize(612, 'leaderboard'))).toBe(true);
    expect(isWidgetResizeMessage(resize(612, 'live-quests', 'chain:0x2105'))).toBe(true);
    expect(isWidgetResizeMessage({ ...resize(612), type: 'other' })).toBe(false);
    expect(isWidgetResizeMessage(resize(612, 'banner'))).toBe(false);
    expect(isWidgetResizeMessage(resize(Number.NaN))).toBe(false);
    expect(isWidgetResizeMessage(resize(5))).toBe(false);
    expect(isWidgetResizeMessage(resize(1e9))).toBe(false);
    expect(isWidgetResizeMessage({ ...resize(612), height: '612' })).toBe(false);
    expect(isWidgetResizeMessage(null)).toBe(false);
    expect(isWidgetResizeMessage('peddlequest:resize')).toBe(false);
  });

  it('checks the source window and the origin before the shape', () => {
    const contentWindow = {};
    const iframe = { contentWindow };
    const origin = 'https://peddlequest.xyz';
    expect(resizeFromEvent({ source: contentWindow, origin, data: resize(300) }, iframe, origin)?.height).toBe(300);
    expect(resizeFromEvent({ source: {}, origin, data: resize(300) }, iframe, origin)).toBeNull();
    expect(resizeFromEvent({ source: contentWindow, origin: 'https://evil.example', data: resize(300) }, iframe, origin)).toBeNull();
    expect(resizeFromEvent({ source: null, origin, data: resize(300) }, { contentWindow: null }, origin)).toBeNull();
  });
});

/* ── mounting ─────────────────────────────────────────────────────────── */

describe('mount functions', () => {
  const g = globalThis as unknown as Record<string, unknown>;
  let env: ReturnType<typeof fakeEnvironment>;

  beforeEach(() => {
    env = fakeEnvironment();
    g.window = env.window;
    g.document = env.document;
  });

  afterEach(() => {
    delete g.window;
    delete g.document;
  });

  const host = (id: string) => {
    const el = new FakeElement('div');
    el.setAttribute('id', id);
    env.body.appendChild(el);
    return el;
  };

  it('mounts the quest widget with theme, ref and the old defaults', () => {
    const el = host('quest');
    const widget = mountQuestWidget('#quest', { linkTitle: 'base-launch-run-quest', ref: 'r1' });
    const frame = widget.iframe as unknown as FakeElement;
    expect(el.children[0]).toBe(frame);
    expect(frame.src).toBe('https://peddlequest.xyz/iframe/base-launch-run-quest?theme=dark&ref=r1');
    expect(frame.style.height).toBe('520px');
    expect(frame.style.maxWidth).toBe('360px');
  });

  it('follows resize messages from its own frame only', () => {
    host('a');
    host('b');
    const a = mountLeaderboardWidget('#a', { linkTitle: 'q', limit: 3 });
    const b = mountLiveQuestsWidget('#b', { chain: 'base' });
    const fa = a.iframe as unknown as FakeElement;
    const fb = b.iframe as unknown as FakeElement;
    const origin = 'https://peddlequest.xyz';

    env.window.dispatch('message', { source: fa.contentWindow, origin, data: resize(333, 'leaderboard') });
    expect(fa.style.height).toBe('333px');
    expect(fb.style.height).toBe('420px');

    // Another frame's window, a foreign origin, a malformed payload: ignored.
    env.window.dispatch('message', { source: fb.contentWindow, origin, data: resize(999) });
    expect(fa.style.height).toBe('333px');
    expect(fb.style.height).toBe('999px');
    env.window.dispatch('message', { source: fa.contentWindow, origin: 'https://evil.example', data: resize(50) });
    env.window.dispatch('message', { source: fa.contentWindow, origin, data: { type: WIDGET_RESIZE_MESSAGE, height: 'x' } });
    expect(fa.style.height).toBe('333px');
  });

  it('setHeight wins over later resize messages; autoHeight:false never follows', () => {
    host('a');
    host('b');
    const a = mountQuestWidget('#a', { linkTitle: 'q' });
    const b = mountQuestWidget('#b', { linkTitle: 'q', autoHeight: false, height: 600 });
    const fa = a.iframe as unknown as FakeElement;
    const fb = b.iframe as unknown as FakeElement;
    const origin = 'https://peddlequest.xyz';

    a.setHeight(700.4);
    env.window.dispatch('message', { source: fa.contentWindow, origin, data: resize(300) });
    env.window.dispatch('message', { source: fb.contentWindow, origin, data: resize(300) });
    expect(fa.style.height).toBe('700px');
    expect(fb.style.height).toBe('600px');
    expect(() => a.setHeight(-1)).toThrow();
  });

  it('destroy removes the frame and the listener', () => {
    const el = host('a');
    const widget = mountLiveQuestsWidget('#a', { project: 'northwind' });
    expect(env.window.count('message')).toBe(1);
    widget.destroy();
    expect(el.children).toHaveLength(0);
    expect(env.window.count('message')).toBe(0);
  });

  it('refuses a missing host element', () => {
    expect(() => mountQuestWidget('#nope', { linkTitle: 'q' })).toThrow(/no element/);
  });
});

/* ── public/widget.js, the zero-JS loader ─────────────────────────────── */

describe('widget.js loader', () => {
  // In the PeddleQuest monorepo the loader is the app's public/widget.js; the
  // standalone quest-sdk repository carries a copy at widget/widget.js.
  const standalone = resolve(__dirname, '..', 'widget', 'widget.js');
  const code = readFileSync(existsSync(standalone) ? standalone : resolve(__dirname, '..', '..', 'public', 'widget.js'), 'utf8');

  const run = (env: ReturnType<typeof fakeEnvironment>) =>
    new Function('window', 'document', 'URL', code)(env.window, env.document, URL);

  it('mounts every marked element, the script tag included, once', () => {
    const env = fakeEnvironment();
    const script = new FakeElement('script');
    script.src = 'https://peddlequest.xyz/widget.js';
    script.setAttribute('data-peddlequest-quest', 'base-launch-run-quest');
    script.setAttribute('data-peddlequest-ref', 'r 1');
    env.body.appendChild(script);
    env.document.currentScript = script;

    const board = new FakeElement('div');
    board.setAttribute('data-peddlequest-leaderboard', 'base-launch-run-quest');
    board.setAttribute('data-peddlequest-limit', '5');
    board.setAttribute('data-peddlequest-theme', 'light');
    env.body.appendChild(board);

    const live = new FakeElement('div');
    live.setAttribute('data-peddlequest-live-quests', '');
    live.setAttribute('data-peddlequest-chain', 'base');
    live.setAttribute('data-peddlequest-limit', 'lots');
    env.body.appendChild(live);

    run(env);

    const questFrame = script.nextSibling as FakeElement;
    expect(questFrame.tagName).toBe('IFRAME');
    expect(questFrame.src).toBe('https://peddlequest.xyz/iframe/base-launch-run-quest?theme=dark&ref=r%201');
    expect(board.children[0].src).toBe('https://peddlequest.xyz/widget/leaderboard/base-launch-run-quest?theme=light&limit=5');
    expect(live.children[0].src).toBe('https://peddlequest.xyz/widget/quests?chain=base&theme=dark');

    // Running it again (a second <script> include) mounts nothing new.
    run(env);
    expect(board.children).toHaveLength(1);
    expect(env.body.children.filter((c) => c.tagName === 'IFRAME')).toHaveLength(1);
  });

  it('resizes only from the right frame and origin', () => {
    const env = fakeEnvironment();
    const script = new FakeElement('script');
    script.src = 'http://localhost:3001/widget.js';
    env.body.appendChild(script);
    env.document.currentScript = script;
    const a = new FakeElement('div');
    a.setAttribute('data-peddlequest-leaderboard', 'q');
    env.body.appendChild(a);
    const b = new FakeElement('div');
    b.setAttribute('data-peddlequest-quest', 'q');
    b.setAttribute('data-peddlequest-auto-height', 'false');
    env.body.appendChild(b);

    run(env);
    const fa = a.children[0];
    const fb = b.children[0];
    expect(fa.src.startsWith('http://localhost:3001/widget/leaderboard/q')).toBe(true);

    const origin = 'http://localhost:3001';
    env.window.dispatch('message', { source: fa.contentWindow, origin, data: resize(321, 'leaderboard') });
    env.window.dispatch('message', { source: fa.contentWindow, origin: 'https://peddlequest.xyz', data: resize(999) });
    env.window.dispatch('message', { source: {}, origin, data: resize(888) });
    env.window.dispatch('message', { source: fb.contentWindow, origin, data: resize(777) });
    expect(fa.style.height).toBe('321px');
    expect(fb.style.height).toBe('520px');
  });
});
