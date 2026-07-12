import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type { WebSocket } from "ws";
import * as syncProtocol from "y-protocols/sync";

import { scheduleSnapshot } from "./persistence";
import type { Room } from "./rooms";

export const MESSAGE_SYNC = 0;

/**
 * Wires this room's Y.Doc so every local change — a client's edit now, an AI
 * agent's edit later — gets broadcast to every OTHER connected client, and
 * schedules a debounced snapshot write. This is the single place update
 * propagation and persistence both hook in; nothing else needs to know why
 * the doc changed. Call once, at room creation.
 */
export function setupSyncBroadcast(room: Room): void {
  room.doc.on("update", (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    for (const client of room.clients) {
      // `origin` is the WebSocket connection readSyncMessage was called with
      // when it applied this update — skip echoing back to whoever sent it.
      if (client !== origin && client.readyState === client.OPEN) {
        client.send(message);
      }
    }

    scheduleSnapshot(room);
  });
}

/** Sent once, right when a client joins: "here's what I have — tell me what you have that I don't." */
export function sendSyncStep1(room: Room, ws: WebSocket): void {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  ws.send(encoding.toUint8Array(encoder));
}

/**
 * Dispatches an incoming sync-category message (SyncStep1, SyncStep2, or
 * Update). readSyncMessage only writes a reply for SyncStep1 (responding
 * with SyncStep2) — a SyncStep2 or Update needs no reply, applying it
 * already triggered the doc.on('update') broadcast to everyone else.
 */
export function handleSyncMessage(room: Room, ws: WebSocket, decoder: decoding.Decoder): void {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  const lengthBeforeReply = encoding.length(encoder);

  syncProtocol.readSyncMessage(decoder, encoder, room.doc, ws);

  if (encoding.length(encoder) > lengthBeforeReply) {
    ws.send(encoding.toUint8Array(encoder));
  }
}
