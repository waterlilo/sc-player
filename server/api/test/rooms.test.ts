import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, Rooms, type RoomTrack } from "../src/rooms.ts";

/** A room service on a clock the test moves by hand. */
function setup() {
  let now = 1_000_000;
  const rooms = new Rooms(() => now);
  const later = (ms: number) => {
    now += ms;
    rooms.tick();
  };
  return { rooms, later, now: () => now };
}

const people = {
  ann: { id: 1, code: "SKY-AAAAA", name: "Ann" },
  bob: { id: 2, code: "SKY-BBBBB", name: "Bob" },
  cat: { id: 3, code: "SKY-CCCCC", name: "Cat" },
};
const track = (id: number, seconds = 100): RoomTrack => ({ id, title: `t${id}`, artist: "a", artworkUrl: null, permalinkUrl: `https://soundcloud.com/a/t${id}`, durationMs: seconds * 1000 });

/** Ann hosts, Bob and Cat joined; everyone has a stream open. */
function room(startTogether = false) {
  const s = setup();
  const r = s.rooms.create(people.ann, { startTogether, track: track(1), position: 0 });
  s.rooms.invite(r.id, 1, [people.bob, people.cat]);
  s.rooms.join(r.id, people.bob);
  s.rooms.join(r.id, people.cat);
  for (const id of [1, 2, 3]) s.rooms.connected(r.id, id);
  return { ...s, id: r.id };
}

test("only the invited get in; the room fills up to its limit", () => {
  const { rooms } = setup();
  const r = rooms.create(people.ann, { startTogether: false });
  assert.throws(() => rooms.join(r.id, people.bob), /invitation/);
  rooms.invite(r.id, 1, [people.bob]);
  rooms.join(r.id, people.bob);
  assert.deepEqual(
    rooms.view(r).members.map((m) => m.code),
    ["SKY-AAAAA", "SKY-BBBBB"],
  );
  // joining twice changes nothing
  rooms.join(r.id, people.bob);
  assert.equal(rooms.view(r).members.length, 2);
  for (let i = 10; i < 10 + LIMITS.members; i++) rooms.invite(r.id, 1, [{ id: i, code: `SKY-${i}`, name: "" }]);
  for (let i = 10; i < 10 + LIMITS.members - 2; i++) rooms.join(r.id, { id: i, code: `SKY-${i}`, name: "" });
  assert.throws(() => rooms.join(r.id, { id: 99, code: "SKY-99", name: "" }), /invitation|full/);
});

test("invitations run out", () => {
  const { rooms, later } = setup();
  const r = rooms.create(people.ann, { startTogether: false });
  rooms.connected(r.id, 1);
  rooms.invite(r.id, 1, [people.bob]);
  assert.equal(rooms.invitesFor(2).length, 1);
  later(LIMITS.inviteMs + 1);
  assert.equal(rooms.invitesFor(2).length, 0);
  assert.throws(() => rooms.join(r.id, people.bob), /invitation/);
});

test("the position moves on while playing, and anyone pauses for all", () => {
  const { rooms, later, id } = room();
  const r = rooms.get(id)!;
  later(10_000);
  assert.equal(rooms.positionOf(r), 10);
  rooms.setPlaying(id, 2, false);
  later(5_000);
  assert.equal(rooms.positionOf(r), 10);
  assert.equal(rooms.view(r).by, "SKY-BBBBB");
  // the same command twice does no harm
  const v = r.version;
  rooms.setPlaying(id, 3, false);
  assert.equal(r.version, v);
  rooms.setPlaying(id, 3, true);
  later(2_000);
  assert.equal(rooms.positionOf(r), 12);
});

test("only the host picks tracks, seeks and edits the queue", () => {
  const { rooms, id } = room();
  assert.throws(() => rooms.play(id, 2, track(2)), /host/);
  assert.throws(() => rooms.seek(id, 2, 30), /host/);
  assert.throws(() => rooms.queueAdd(id, 2, track(2)), /host/);
  rooms.queueAdd(id, 1, track(2));
  rooms.queueAdd(id, 1, track(3), true);
  assert.deepEqual(
    rooms.get(id)!.queue.map((q) => q.track.id),
    [3, 2],
  );
});

test("a track that ended gives way to the next in the queue; an empty queue stops the room", () => {
  const { rooms, later, id } = room();
  const r = rooms.get(id)!;
  rooms.queueAdd(id, 1, track(2, 50));
  later(100_000 + LIMITS.endGraceMs);
  assert.equal(r.track!.id, 2);
  assert.equal(rooms.positionOf(r), 0);
  later(50_000 + LIMITS.endGraceMs);
  assert.equal(r.playing, false);
  assert.deepEqual(
    rooms.view(r).history.map((h) => h.track.id),
    [1, 2],
  );
});

test("suggestions: a few each, no repeats, the host takes them or not", () => {
  const { rooms, id } = room();
  const r = rooms.get(id)!;
  assert.equal(rooms.suggest(id, 2, track(5)), "suggested");
  assert.equal(rooms.suggest(id, 3, track(5)), "already");
  for (let i = 1; i < LIMITS.suggestionsEach; i++) rooms.suggest(id, 2, track(5 + i));
  assert.throws(() => rooms.suggest(id, 2, track(50)), /at most/);
  assert.throws(() => rooms.decide(id, 2, r.suggestions[0]!.uid, true), /host/);
  rooms.decide(id, 1, r.suggestions[0]!.uid, true);
  rooms.decide(id, 1, r.suggestions[0]!.uid, false);
  assert.deepEqual(
    r.queue.map((q) => [q.track.id, q.by]),
    [[5, "SKY-BBBBB"]],
  );
  assert.deepEqual(
    r.suggestions.map((s) => s.track.id),
    Array.from({ length: LIMITS.suggestionsEach - 2 }, (_, i) => 7 + i),
  );
  // a host's own "suggestion" goes straight to the queue
  rooms.suggest(id, 1, track(9));
  assert.equal(r.queue.at(-1)!.track.id, 9);
});

test("the host leaving or gone hands the room to who joined first", () => {
  const { rooms, later, id } = room();
  const r = rooms.get(id)!;
  rooms.queueAdd(id, 1, track(2));
  rooms.leave(id, 1);
  assert.equal(rooms.view(r).host, "SKY-BBBBB");
  // the queue and the track stay
  assert.equal(r.queue.length, 1);
  assert.equal(r.track!.id, 1);
  // Bob's connection drops: after a while Cat (still here) becomes host
  rooms.disconnected(id, 2);
  later(LIMITS.hostGoneMs - 1000);
  assert.equal(rooms.view(r).host, "SKY-BBBBB");
  later(2000);
  assert.equal(rooms.view(r).host, "SKY-CCCCC");
  // Bob comes back before he's dropped: a member again, not host
  rooms.connected(id, 2);
  later(LIMITS.memberGoneMs);
  assert.deepEqual(
    rooms.view(r).members.map((m) => m.code),
    ["SKY-BBBBB", "SKY-CCCCC"],
  );
});

test("members gone for long leave; a room nobody is in closes", () => {
  const { rooms, later, id } = room();
  let closed = false;
  rooms.subscribe(id, (c) => (closed ||= c));
  rooms.disconnected(id, 3);
  later(LIMITS.memberGoneMs + 1);
  assert.equal(rooms.get(id)!.members.length, 2);
  rooms.disconnected(id, 1);
  rooms.disconnected(id, 2);
  later(LIMITS.memberGoneMs + 1);
  assert.equal(rooms.get(id), undefined);
  assert.ok(closed);
});

test("start together: waits for everyone connected, or for the timeout", () => {
  const { rooms, later, id } = room(true);
  const r = rooms.get(id)!;
  rooms.play(id, 1, track(2));
  assert.equal(r.playing, false);
  rooms.ready(id, 1, 2);
  rooms.ready(id, 2, 2);
  assert.equal(r.playing, false);
  // a ready for another track counts for nothing
  rooms.ready(id, 3, 1);
  assert.equal(r.playing, false);
  rooms.ready(id, 3, 2);
  assert.equal(r.playing, true);
  assert.equal(rooms.positionOf(r), 0);
  // someone slow: the room starts anyway after a few seconds
  rooms.play(id, 1, track(3));
  rooms.ready(id, 1, 3);
  later(LIMITS.startWaitMs);
  assert.equal(r.playing, true);
});

test("being in another room: creating or joining one leaves it", () => {
  const { rooms, id } = room();
  const other = rooms.create(people.bob, { startTogether: false });
  assert.equal(rooms.roomOf(2)!.id, other.id);
  assert.deepEqual(
    rooms.view(rooms.get(id)!).members.map((m) => m.code),
    ["SKY-AAAAA", "SKY-CCCCC"],
  );
});

test("a list put on plays through after the queue; suggestions taken go before the rest of it", () => {
  const { rooms, later, id } = room();
  const r = rooms.get(id)!;
  // the autopilot's picks make way for a list; what the host queued itself stays
  rooms.queueAdd(id, 1, track(60), false, true);
  rooms.queueAdd(id, 1, track(61));
  rooms.playList(id, 1, [track(10, 10), track(11, 10), track(12, 10), track(13, 10)], "Night drive");
  assert.deepEqual(rooms.view(r).queue.map((q) => q.track.id), [61]);
  rooms.queueRemove(id, 1, rooms.view(r).queue[0]!.uid);
  let v = rooms.view(r);
  assert.equal(v.track?.id, 10);
  assert.deepEqual(v.list && { title: v.list.title, left: v.list.left, next: v.list.next.map((x) => x.track.id) }, { title: "Night drive", left: 3, next: [11, 12, 13] });
  assert.throws(() => rooms.playList(id, 2, [track(20)], ""), /only the host/);
  // Bob suggests, Ann takes it: it plays next, then the list goes on
  rooms.suggest(id, 2, track(30, 10));
  rooms.decide(id, 1, rooms.view(r).suggestions[0]!.uid, true);
  later(11_000);
  assert.equal(rooms.view(r).track?.id, 30);
  later(11_000);
  assert.equal(rooms.view(r).track?.id, 11);
  // the host takes one out and skips on
  rooms.listRemove(id, 1, rooms.view(r).list!.next[0]!.uid);
  rooms.next(id, 1);
  assert.equal(rooms.view(r).track?.id, 13);
  v = rooms.view(r);
  assert.equal(v.list, null);
  // nothing left: the room stops at the end
  later(11_000);
  assert.equal(rooms.view(r).playing, false);
});

test("a list is cut at its limit and can be cleared", () => {
  const { rooms, id } = room();
  const r = rooms.get(id)!;
  rooms.playList(id, 1, Array.from({ length: LIMITS.list + 20 }, (_, i) => track(100 + i)), "");
  assert.equal(rooms.view(r).list?.left, LIMITS.list);
  assert.equal(rooms.view(r).list?.next.length, 20);
  rooms.listClear(id, 1);
  assert.equal(rooms.view(r).list, null);
  // the rest of a long list comes after the first part, up to the limit
  rooms.playList(id, 1, [track(1), track(2)], "Likes");
  rooms.listAppend(id, 1, Array.from({ length: LIMITS.list }, (_, i) => track(1000 + i)));
  assert.deepEqual([rooms.view(r).list?.title, rooms.view(r).list?.left, rooms.view(r).list?.next[1]?.track.id], ["Likes", LIMITS.list, 1000]);
  assert.throws(() => rooms.listAppend(id, 2, [track(5)]), /only the host/);
});

test("the host hands the room to another member", () => {
  const { rooms, id } = room();
  const r = rooms.get(id)!;
  rooms.suggest(id, 3, track(40));
  assert.throws(() => rooms.handOver(id, 2, people.cat.code), /only the host/);
  assert.throws(() => rooms.handOver(id, 1, "SKY-ZZZZZ"), /not in this room/);
  rooms.handOver(id, 1, people.cat.code);
  const v = rooms.view(r);
  assert.equal(v.host, people.cat.code);
  // Cat's own suggestion is the host's choice now
  assert.equal(v.suggestions.length, 0);
  assert.throws(() => rooms.next(id, 1), /only the host/);
  rooms.next(id, 3);
});

test("a member suggests a whole playlist: one suggestion, its name and size shown, taken after what is put on", () => {
  const { rooms, id, later } = room();
  const list = [track(20), track(21), track(22)];
  assert.equal(rooms.suggestList(id, 2, list, "Night"), "suggested");
  assert.equal(rooms.suggestList(id, 2, list, "Night"), "already");
  const view = rooms.view(rooms.get(id)!);
  assert.equal(view.suggestions.length, 1);
  assert.deepEqual((view.suggestions[0] as { list?: unknown }).list, { title: "Night", count: 3 });
  assert.equal(view.suggestions[0]!.track.id, 20);
  // it counts as one of the member's few
  for (let i = 0; i < LIMITS.suggestionsEach - 1; i++) rooms.suggest(id, 2, track(40 + i));
  assert.throws(() => rooms.suggestList(id, 2, [track(50)], "More"), /at most/);
  // the host takes it: it plays after the current track, in order
  rooms.decide(id, 1, view.suggestions[0]!.uid, true);
  assert.deepEqual(rooms.get(id)!.list?.items.map((x) => x.track.id), [20, 21, 22]);
  later(101_000);
  assert.equal(rooms.get(id)!.track?.id, 20);
  // the host suggesting a list just puts it on
  rooms.suggestList(id, 1, [track(30), track(31)], "Mine");
  assert.equal(rooms.get(id)!.track?.id, 30);
});

test("a playlist taken when the room has stopped starts at once", () => {
  const { rooms, id, later } = room();
  later(101_000);
  assert.equal(rooms.get(id)!.playing, false);
  rooms.suggestList(id, 3, [track(60), track(61)], "Late");
  rooms.decide(id, 1, rooms.get(id)!.suggestions[0]!.uid, true);
  assert.equal(rooms.get(id)!.track?.id, 60);
  assert.equal(rooms.get(id)!.playing, true);
});
