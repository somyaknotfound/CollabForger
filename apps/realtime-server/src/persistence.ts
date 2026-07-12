import * as Y from "yjs";

import { DocumentSnapshot } from "./models/Document";
import type { Room } from "./rooms";

const SNAPSHOT_DEBOUNCE_MS = Number(process.env.SNAPSHOT_DEBOUNCE_MS) || 2000;
const SNAPSHOT_MAX_INTERVAL_MS = Number(process.env.SNAPSHOT_MAX_INTERVAL_MS) || 30000;

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
    void writeSnapshot(room);
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
