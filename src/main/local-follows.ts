import { join } from "node:path";
import { app } from "electron";
import type { FollowShape } from "./sync/docs";
import { JsonFile } from "./store/json-file";

/**
 * Artists the person follows, kept in sc player (follows.json) and synced to their other devices: filled from
 * SoundCloud by the account import (main/sync/sc-import), so the phone knows them without a SoundCloud sign-in. The
 * PC's "Subscriptions" page still reads SoundCloud for now; this list is what the phone shows.
 */

let file: JsonFile<{ users: Record<string, FollowShape> }> | null = null;
const store = () => (file ??= new JsonFile<{ users: Record<string, FollowShape> }>(join(app.getPath("userData"), "follows.json"), { users: {} }, 1000));
export const flushFollows = () => file?.flush();

let onChange: (() => void) | null = null;
/** Called after every change made here (sync sends it a little later). */
export const onFollowsChange = (fn: () => void) => (onChange = fn);

export const followsData = (): Readonly<Record<string, FollowShape>> => store().get().users;

/** New ones added (newest first in `users`); the ones already here stay as they are. */
export function addFollows(users: FollowShape["user"][], now = Date.now()) {
  const have = { ...store().get().users };
  let n = 0;
  users.forEach((user, i) => {
    if (have[String(user.id)]) return;
    have[String(user.id)] = { user, at: now - i };
    n++;
  });
  if (!n) return;
  store().patch({ users: have });
  onChange?.();
}

/** The list as merged with the other devices (main/sync): it replaces this one, without counting as a change here. */
export const applyFollows = (users: Record<string, FollowShape>) => store().patch({ users });
