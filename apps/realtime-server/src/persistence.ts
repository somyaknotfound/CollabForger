import * as Y from "yjs";

import { redisPub } from "./config/redis";
import { INSTANCE_ID } from "./instanceId";
import { DocumentSnapshot } from "./models/Document";
import type { Room } from "./rooms";

const SNAPSHOT_DEBOUNCE_MS = Number(process.env.SNAPSHOT_DEBOUNCE_MS) || 2000;
const SNAPSHOT_MAX_INTERVAL_MS = Number(process.env.SNAPSHOT_MAX_INTERVAL_MS) || 30000;
const SNAPSHOT_LOCK_TTL_MS = 10000;

// Only deletes the lock if it still holds OUR token — guards against
// deleting a lock a different instance acquired after ours expired mid-write.
const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

function snapshotLockKey(documentId: string): string {
  return `doc:${documentId}:snapshot:lock`;
}

async function acquireSnapshotLock(documentId: string): Promise<boolean> {
  const result = await redisPub.set(snapshotLockKey(documentId), INSTANCE_ID, "PX", SNAPSHOT_LOCK_TTL_MS, "NX");
  return result === "OK";
}

async function releaseSnapshotLock(documentId: string): Promise<void> {
  await redisPub.eval(RELEASE_LOCK_SCRIPT, 1, snapshotLockKey(documentId), INSTANCE_ID);
}

/**
 * Loads the last persisted Y.Doc snapshot for a document, if one exists.
 * Called once, while a room is being created — before any client's initial
 * sync handshake, so the very first client to join sees the document's saved
 * content instead of a blank doc. Failures degrade to "start blank" rather
 * than blocking room creation — a Mongo hiccup shouldn't take down live
 * collaboration, just its durability until Mongo recovers.
 */
export async function loadSnapshot(documentId: string): Promise<Uint8Array | null> {
  try {
    // Not .lean() — a lean query skips Mongoose's schema-aware casting, so a
    // Buffer-typed field would come back as a raw BSON Binary object instead
    // of an actual Buffer.
    const doc = await DocumentSnapshot.findById(documentId).select("yjsState");
    if (!doc?.yjsState) return null;
    return new Uint8Array(doc.yjsState);
  } catch (err) {
    console.error(`snapshot load failed for document ${documentId}, starting blank:`, err);
    return null;
  }
}

async function writeSnapshot(room: Room): Promise<void> {
  const update = Y.encodeStateAsUpdate(room.doc);
  try {
    await DocumentSnapshot.findByIdAndUpdate(room.documentId, {
      $set: { yjsState: Buffer.from(update), lastEditedAt: new Date() },
      $inc: { yjsStateVersion: 1 },
    });
    room.lastSnapshotAt = Date.now();
  } catch (err) {
    console.error(`snapshot write failed for room ${room.documentId}:`, err);
  }
}

/**
 * Same as writeSnapshot, but guarded by a short Redis lock so that when
 * multiple instances host clients for the same room (they converge to the
 * same Yjs state via Redis fan-out, but each runs its own debounce timer),
 * only one of them actually writes to Mongo at a time. This isn't a
 * correctness requirement — concurrent unlocked writes would just be
 * redundant, never corrupting, since CRDT state converges regardless — it
 * only exists to cut duplicate writes. If the lock isn't acquired, skip: the
 * instance holding it is about to save equivalent state, and our own timer
 * will fire again soon regardless.
 */
async function writeSnapshotIfLockAcquired(room: Room): Promise<void> {
  const acquired = await acquireSnapshotLock(room.documentId);
  if (!acquired) return;

  try {
    await writeSnapshot(room);
  } finally {
    await releaseSnapshotLock(room.documentId);
  }
}

/**
 * Call after every doc update. Debounces writes so rapid edits don't cause a
 * Mongo write per keystroke, but caps how long a continuously-active room can
 * go without saving — every update resets a short timer, but that timer is
 * never allowed to push the write past SNAPSHOT_MAX_INTERVAL_MS since the
 * last successful save.
 */
export function scheduleSnapshot(room: Room): void {
  if (room.snapshotTimer) {
    clearTimeout(room.snapshotTimer);
  }

  const sinceLastSnapshot = Date.now() - room.lastSnapshotAt;
  const delay =
    sinceLastSnapshot >= SNAPSHOT_MAX_INTERVAL_MS
      ? 0 // already overdue — write now
      : Math.min(SNAPSHOT_DEBOUNCE_MS, SNAPSHOT_MAX_INTERVAL_MS - sinceLastSnapshot);

  room.snapshotTimer = setTimeout(() => {
    room.snapshotTimer = null;
    void writeSnapshotIfLockAcquired(room);
  }, delay);
}

/** Called when the last client leaves a room — guarantees the final state is saved. */
export async function flushSnapshot(room: Room): Promise<void> {
  if (room.snapshotTimer) {
    clearTimeout(room.snapshotTimer);
    room.snapshotTimer = null;
  }
  await writeSnapshot(room);
}
