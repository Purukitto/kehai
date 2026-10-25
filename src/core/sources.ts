/**
 * The sources the widgets Kehai ships with read, by the id their description
 * files name them by. Nobody installs a source: it comes with the widgets
 * that read it, and widgets that read the same one share it. Every one of
 * these reads only the computer Kehai runs on.
 *
 * A source's first topic is the one that says whether it is reporting.
 */
export const SOURCES = {
  clock: { name: 'Clock', topics: ['os:clock'] },
  cpu: { name: 'Processor', topics: ['telemetry:cpu'] },
  memory: { name: 'Memory', topics: ['telemetry:mem'] },
  network: { name: 'Network', topics: ['telemetry:net'] },
  disk: { name: 'Disk', topics: ['telemetry:disk'] },
  focus: { name: 'Focus timer', topics: ['flow:pomodoro'] },
  tokens: { name: 'Agent tokens', topics: ['dev:llm_tokens'] },
  agents: { name: 'Agent sessions', topics: ['dev:agents'] },
  media: { name: 'Media session', topics: ['media:now_playing', 'media:art', 'media:volume'] },
  notifications: { name: 'Notifications', topics: ['sys:notify'] },
} as const satisfies Record<string, { name: string; topics: readonly string[] }>;

export type SourceId = keyof typeof SOURCES;

export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];

export function isSourceId(v: unknown): v is SourceId {
  return typeof v === 'string' && Object.hasOwn(SOURCES, v);
}
