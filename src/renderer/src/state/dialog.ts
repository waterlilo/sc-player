import { create } from "zustand";

/**
 * The app's own questions (components/Dialog), instead of the system's confirm / prompt boxes — those look foreign,
 * and Electron has no prompt at all. One at a time; asking again answers the open one with "no".
 */
interface Pending {
  message: string;
  /** the button that says yes */
  confirm: string;
  /** a destructive yes (deleting, removing): the button is red */
  danger?: boolean;
  /** asks for a line of text too (the yes is then that text) */
  input?: { placeholder: string; maxLength?: number };
  resolve: (answer: string | null) => void;
}

export const useDialog = create<{ pending: Pending | null }>(() => ({ pending: null }));

function open(p: Omit<Pending, "resolve">): Promise<string | null> {
  useDialog.getState().pending?.resolve(null);
  return new Promise((resolve) => useDialog.setState({ pending: { ...p, resolve } }));
}

/** Yes or no. */
export const ask = async (message: string, confirm: string, danger = false) => (await open({ message, confirm, danger })) !== null;

/** A line of text, or null when cancelled. */
export const askText = (message: string, confirm: string, placeholder: string, maxLength = 200) => open({ message, confirm, input: { placeholder, maxLength } });

export function answer(value: string | null) {
  const p = useDialog.getState().pending;
  if (!p) return;
  useDialog.setState({ pending: null });
  p.resolve(value);
}
