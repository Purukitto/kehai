import { bus } from './bus';
import { isTauri } from './tauriSource';
import type { Envelope } from './types';

/**
 * The renderer as served to another machine by the engine's remote server.
 *
 * Same bus, same widgets: envelopes arrive over a WebSocket instead of the
 * Tauri bridge, and the UI cannot tell the difference. The page carries no
 * secrets — it is the same bundle as the desktop app — so the server hands it
 * out to anyone; the socket is what needs the key.
 */
function isRemote(): boolean {
  return typeof document !== 'undefined' && document.querySelector('meta[name="kehai-remote"]') !== null;
}

/**
 * This page is a remote panel, served by another machine's engine rather than
 * running inside one. Fixed for the life of the page, so it is read once.
 */
export const REMOTE_PANEL = !isTauri() && isRemote();

/**
 * Where the panel stands with its host. `heard` is when the host last said
 * anything, kept while it is away so the panel can say how old its readings
 * are; null until it has said something on this page.
 */
export type RemoteLink =
  | { state: 'connecting'; heard: number | null }
  | { state: 'live'; control: boolean }
  | { state: 'offline'; heard: number | null; retryAt: number }
  | { state: 'unpaired'; reason: string };

const KEY_STORE = 'kehai.remote.key';
const NAME_STORE = 'kehai.remote.name';
/** Close code the host uses for a missing, wrong or replaced key. Mirrors `remote.rs`. */
const CLOSE_UNPAIRED = 4401;
/** Two missed beats and some. The host beats every 20 seconds (`PING_EVERY` in `remote.rs`). */
const SILENT_FOR = 45_000;
/**
 * What a remote panel may ask the host for. The host checks again and refuses
 * anything else, so this only saves sending what would be refused.
 */
const FORWARDED = ['media:command', 'notify:command', 'flow:command'];

function readKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
}

function storeKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    // Storage refused: pairing lasts until the tab closes.
  }
}

let hostName: string | null = null;

/**
 * What the host calls itself, as it said when the panel last connected, and
 * kept so a panel reloaded while the host is off can still name it. Its
 * address until it has said.
 */
export function remoteHostName(): string {
  if (hostName) return hostName;
  try {
    return localStorage.getItem(NAME_STORE) ?? location.hostname;
  } catch {
    return location.hostname;
  }
}

function storeName(name: string) {
  hostName = name;
  try {
    localStorage.setItem(NAME_STORE, name);
  } catch {
    // Storage refused: the name lasts until the tab closes.
  }
}

/** A bare key, or one inside the link Settings hands out. */
function keyIn(text: string): string | null {
  const match = /(?:^|key=)([0-9a-f]{32})(?:$|&)/i.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * The link carries its key in the fragment, which browsers never send to a
 * server. It is kept and then taken out of the address bar, so it is not left
 * on screen for anyone glancing at the panel.
 */
function takeKeyFromLink() {
  const key = keyIn(location.hash.replace(/^#/, ''));
  if (!key) return;
  storeKey(key);
  history.replaceState(null, '', location.pathname + location.search);
}

let reconnect: (() => void) | null = null;

/** Pairs with the key in `text`, a bare key or a whole link. False when it holds none. */
export function pairRemote(text: string): boolean {
  const key = keyIn(text);
  if (!key) return false;
  storeKey(key);
  reconnect?.();
  return true;
}

export function forgetRemote() {
  storeKey(null);
  reconnect?.();
}

export function startRemoteSource(onLink: (link: RemoteLink) => void): () => void {
  takeKeyFromLink();

  let ws: WebSocket | null = null;
  let stopped = false;
  let retry = 0;
  let timer: number | undefined;
  let control = false;
  let heard: number | null = null;
  let opened = 0;

  const connect = () => {
    const key = readKey();
    if (!key) {
      onLink({ state: 'unpaired', reason: 'This panel has no key yet.' });
      return;
    }

    onLink({ state: 'connecting', heard });
    const socket = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/bus');
    ws = socket;

    socket.onopen = () => {
      opened = Date.now();
      socket.send(JSON.stringify({ type: 'hello', key }));
    };

    socket.onmessage = (event) => {
      let msg: unknown;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      heard = Date.now();
      const m = msg as { type?: unknown; control?: unknown; topic?: unknown; name?: unknown };
      if (m.type === 'welcome') {
        retry = 0;
        control = m.control === true;
        if (typeof m.name === 'string' && m.name) storeName(m.name);
        onLink({ state: 'live', control });
      } else if (typeof m.topic === 'string') {
        bus.ingest(msg as Envelope);
      }
    };

    socket.onclose = (event) => lost(socket, event.code, event.reason);
  };

  const lost = (socket: WebSocket, code: number, reason: string) => {
    // A socket replaced by `reconnect`, or given up on, has nothing more to say.
    if (stopped || ws !== socket) return;
    ws = null;
    control = false;
    if (code === CLOSE_UNPAIRED) {
      onLink({ state: 'unpaired', reason: reason || 'The host did not accept this key.' });
      return;
    }
    // Backs off to half a minute, so a host that is off for the night is
    // not asked every second until morning.
    const delay = Math.min(30_000, 1000 * 2 ** retry);
    retry += 1;
    onLink({ state: 'offline', heard, retryAt: Date.now() + delay });
    timer = window.setTimeout(connect, delay);
  };

  // A host that sleeps or loses its network mid-connection closes nothing,
  // and a browser can hold the dead socket open for hours. The host beats
  // every 20 seconds, so this much silence means it is gone.
  const watchdog = window.setInterval(() => {
    const socket = ws;
    if (socket?.readyState === WebSocket.OPEN && Date.now() - Math.max(opened, heard ?? 0) > SILENT_FOR) {
      lost(socket, 1006, '');
      socket.close();
    }
  }, 5000);

  reconnect = () => {
    window.clearTimeout(timer);
    retry = 0;
    const old = ws;
    ws = null;
    old?.close();
    connect();
  };

  // Without control the host refuses every command, so none is sent: the
  // header already says the panel is view-only.
  const stopCommands = FORWARDED.map((topic) =>
    bus.subscribe(topic, (envelope) => {
      if (control && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'command', topic, data: envelope.data }));
      }
    })
  );

  connect();

  return () => {
    stopped = true;
    reconnect = null;
    window.clearTimeout(timer);
    window.clearInterval(watchdog);
    stopCommands.forEach((stop) => stop());
    ws?.close();
  };
}
