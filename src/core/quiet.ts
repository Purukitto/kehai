import { createContext, useContext } from 'react';

/**
 * True while nobody is at the desk and the whole panel stays on screen,
 * dimmed. Anything that would show what someone wrote hides it, so a panel
 * left on for the room says how many notifications came, never what they say.
 */
export const HideText = createContext(false);

export const useHideText = (): boolean => useContext(HideText);
