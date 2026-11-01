import { createContext, useContext } from 'react';
import type { Section } from '../settings/SettingsScreen';

/**
 * What a tile may ask of the app shell: a place to go, never a setting to
 * change. A tile that wants a setting changed sends you to where it lives.
 */
export interface Nav {
  openSettings: (section: Section) => void;
  /** The game widget shown full screen, if one is. */
  full: string | null;
  /** Shows a game widget full screen, or the layout again with null. */
  setFull: (widget: string | null) => void;
}

const NavContext = createContext<Nav>({ openSettings: () => undefined, full: null, setFull: () => undefined });

export const NavProvider = NavContext.Provider;

export function useNav(): Nav {
  return useContext(NavContext);
}
