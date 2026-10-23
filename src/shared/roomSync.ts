/**
 * Keeping a listening room together (state/room.ts): where the room's track is by the server's clock, and how this app
 * meets it. A small difference is made up without a jump — a few percent faster or slower for some seconds, the pitch
 * kept; a large one with a seek. Pure: tested on its own.
 */

export interface RoomClock {
  position: number;
  at: number;
  playing: boolean;
}

/** Where the room is, in seconds, at the server time `serverNow`. */
export const roomPosition = (r: RoomClock, serverNow: number) => (r.playing ? r.position + (serverNow - r.at) / 1000 : r.position);

/** within this the room is together: nothing to do */
const NEAR = 0.08;
/** beyond this a seek, nearer a change of speed */
const FAR = 1.5;
/** speed changes stay within ±5%: not heard as a different song */
const MAX_RATE = 0.05;
/** a seek lands a little late (the decoder starts again): aim that much ahead */
export const SEEK_LEAD = 0.12;

export interface Correction {
  /** jump here */
  seek?: number;
  /** play at this speed until the next check */
  rate: number;
}

/** right after a track loads or the room resumes, a gap is the loading time, not drift: a seek closes it beyond this */
export const SETTLING_FAR = 0.3;

/**
 * How to meet the room from `local` (this app's place in the track) when the room is at `target`; `far`: from how far
 * a seek (smaller while settling in, see SETTLING_FAR).
 */
export function correction(local: number, target: number, far = FAR): Correction {
  const behind = target - local;
  if (Math.abs(behind) > far) return { seek: target + SEEK_LEAD, rate: 1 };
  if (Math.abs(behind) <= NEAR) return { rate: 1 };
  // make up the difference over about three seconds, within the limits
  return { rate: 1 + Math.max(-MAX_RATE, Math.min(MAX_RATE, behind / 3)) };
}
