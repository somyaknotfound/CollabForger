import type { WebSocket } from "ws";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { setupAwarenessBroadcast } from "./awareness";
import { flushSnapshot, loadSnapshot } from "./persistence";
import { setupSyncBroadcast } from "./sync";

export interface Room {
  documentId: string;
  doc: Y.Doc;
  awareness: Awareness;
  clients: Set<WebSocket>;
  /** Which awareness clientIDs each connection introduced — used to clean up on disconnect. */
  connectionAwarenessIds: Map<WebSocket, Set<number>>;
  snapshotTimer: NodeJS.Timeout | null;
  lastSnapshotAt: number;
}

const rooms = new Map<string, Room>();

// Room creation is async (it loads a Mongo snapshot) — if two clients for the
// same brand-new document connect within the same few milliseconds, both
// would otherwise see "no room yet" and race to create separate, divergent
// rooms. Tracking the in-flight creation promise means concurrent callers
// await the same creation instead.
const roomCreationPromises = new Map<string, Promise<Room>>();

async function createRoom(documentId: string): Promise<Room> {
  const doc = new Y.Doc();
  const snapshot = await loadSnapshot(documentId);
  if (snapshot) {
    Y.applyUpdate(doc, snapshot);
  }

  const room: Room = {
    documentId,
    doc,
    awareness: new Awareness(doc),
    clients: new Set(),
    connectionAwarenessIds: new Map(),
    snapshotTimer: null,
    lastSnapshotAt: Date.now(),
  };
  // Registered only after the snapshot is applied, so loading it doesn't
  // trigger a broadcast (to zero clients) or immediately re-schedule a
  // snapshot write of the data we just loaded.
  setupSyncBroadcast(room);
  setupAwarenessBroadcast(room);

  console.log(`room created: ${documentId}${snapshot ? " (restored from snapshot)" : ""}`);
  return room;
}

export async function getOrCreateRoom(documentId: string): Promise<Room> {
  const existing = rooms.get(documentId);
  if (existing) return existing;

  const inFlight = roomCreationPromises.get(documentId);
  if (inFlight) return inFlight;

  const creation = createRoom(documentId);
  roomCreationPromises.set(documentId, creation);
  try {
    const room = await creation;
    rooms.set(documentId, room);
    return room;
  } finally {
    roomCreationPromises.delete(documentId);
  }
}

export async function destroyRoom(documentId: string): Promise<void> {
  const room = rooms.get(documentId);
  if (!room) return;

  await flushSnapshot(room);

  room.awareness.destroy();
  room.doc.destroy();
  rooms.delete(documentId);
  console.log(`room destroyed: ${documentId}`);
}

export function roomCount(): number {
  return rooms.size;
}
