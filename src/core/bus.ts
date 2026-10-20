import type { Envelope } from './types';

type Handler = (e: Envelope) => void;

/**
 * Pub/sub with last-value retention.
 *
 * The retention is the important part: a widget mounted after its source has
 * already published gets the last value synchronously on subscribe, so no tile
 * ever boots blank waiting for the next poll.
 */
class EventBus {
  private handlers = new Map<string, Set<Handler>>();
  private retained = new Map<string, Envelope>();

  publish<T>(topic: string, src: string, data: T): void {
    this.dispatch({ topic, ts: Date.now(), src, data } as Envelope);
  }

  /**
   * Accept an envelope minted elsewhere — the Rust engine, or a headless client
   * on the local API. Its `ts` and `src` are preserved, because they describe
   * when the reading was taken and by what, not when it reached the renderer.
   */
  ingest(envelope: Envelope): void {
    this.dispatch(envelope);
  }

  private dispatch(envelope: Envelope): void {
    this.retained.set(envelope.topic, envelope);

    for (const [pattern, set] of this.handlers) {
      if (matches(pattern, envelope.topic)) {
        for (const fn of set) fn(envelope);
      }
    }
  }

  subscribe(pattern: string, fn: Handler): () => void {
    let set = this.handlers.get(pattern);
    if (!set) {
      set = new Set();
      this.handlers.set(pattern, set);
    }
    set.add(fn);

    for (const [topic, envelope] of this.retained) {
      if (matches(pattern, topic)) fn(envelope);
    }

    const registered = set;
    return () => {
      registered.delete(fn);
      if (registered.size === 0) this.handlers.delete(pattern);
    };
  }

  peek<T>(topic: string): Envelope<T> | undefined {
    return this.retained.get(topic) as Envelope<T> | undefined;
  }

  topics(): string[] {
    return [...this.retained.keys()].sort();
  }
}

/** Supports an exact topic or a single trailing wildcard: 'telemetry:*'. */
function matches(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  if (!pattern.endsWith('*')) return false;
  return topic.startsWith(pattern.slice(0, -1));
}

export const bus = new EventBus();
