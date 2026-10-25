import { create } from "zustand";

/**
 * An action SoundCloud's bot protection stopped (a like, adding to a playlist), waiting for the person to pass the
 * site's check: the dialog (CheckDialog) offers to do it on soundcloud.com in the app or in the browser, then tries
 * the action again.
 */
export interface PendingCheck {
  /** what was being done, for the dialog ("Like", "Add to playlist") */
  action: string;
  /** the soundcloud.com page to do it on */
  url: string;
  /** tries the action again (or finds it done on the site); true when it went through */
  retry: () => Promise<boolean>;
}

export const useCheck = create<{ pending: PendingCheck | null }>(() => ({ pending: null }));

export const askCheck = (pending: PendingCheck) => useCheck.setState({ pending });
export const closeCheck = () => useCheck.setState({ pending: null });
