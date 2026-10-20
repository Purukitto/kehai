import { useEffect, useState } from 'react';
import { bus } from './bus';
import type { Envelope } from './types';

/**
 * Subscribe a component to one topic. Returns the latest payload, or undefined
 * until the first event arrives - undefined is a real state, and widgets are
 * expected to render it as "awaiting first event", never as zero.
 */
export function useTopic<T>(topic: string): T | undefined {
  const [value, setValue] = useState<T | undefined>(() => bus.peek<T>(topic)?.data);

  useEffect(() => bus.subscribe(topic, (e: Envelope) => setValue(e.data as T)), [topic]);

  return value;
}
