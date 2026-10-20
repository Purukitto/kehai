import { bus } from './bus';
import type { Envelope } from './types';

/**
 * Bridges the Rust integration engine onto the renderer's bus, in both
 * directions.
 *
 * Inbound: the engine emits one Tauri event, `bus`, carrying an envelope.
 * Everything downstream — subscriptions, retention, widgets — is unchanged from
 * the mock, which is the point: the UI cannot tell which source it is talking
 * to.
 *
 * Outbound: topics in `COMMAND_TOPICS` are forwarded back out as Tauri events.
 * Without this a widget publishing a command reaches only the other widgets,
 * and the engine never hears it.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Topics the Rust engine currently owns. The mock skips these. */
export const ENGINE_TOPICS = [
  'telemetry:cpu',
  'telemetry:mem',
  'telemetry:net',
  'telemetry:disk',
  'dev:llm_tokens',
  'media:now_playing',
  'media:art',
  'sys:notify',
];

/** Topics that travel renderer → engine. The only write path in the app. */
export const COMMAND_TOPICS = ['media:command', 'notify:command'];

export async function startTauriSource(): Promise<() => void> {
  const { emit, listen } = await import('@tauri-apps/api/event');

  const unlisten = await listen<Envelope>('bus', (event) => {
    const envelope = event.payload;
    if (envelope && typeof envelope.topic === 'string') {
      bus.ingest(envelope);
    }
  });

  const stopCommands = COMMAND_TOPICS.map((topic) =>
    bus.subscribe(topic, (envelope) => {
      void emit(topic, envelope.data);
    })
  );

  // Tells the engine a renderer is listening. If the capability that allows
  // this is missing, the await above throws and the caller reports it rather
  // than leaving widgets on a dash forever.
  await emit('ui:hello', {});

  return () => {
    stopCommands.forEach((stop) => stop());
    unlisten();
  };
}
