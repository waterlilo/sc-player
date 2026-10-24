/**
 * SoundCloud didn't answer (a request failed before any response). The proxy's "auto" mode listens: it checks whether
 * the user's own connection still reaches SoundCloud and switches to sc player's proxy when it doesn't. Resolves with
 * whether the way out changed, so a caller can try again.
 */
let listener: (() => Promise<boolean>) | null = null;

export const onNetTrouble = (f: () => Promise<boolean>) => {
  listener = f;
};

export const reportNetTrouble = async (): Promise<boolean> => (listener ? listener().catch(() => false) : false);
