import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import type { WebSocket } from "ws";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

import { RECV_FROM_REDIS, redisPub, subscribeChannel, unsubscribeChannel } from "./config/redis";
import { scheduleSnapshot } from "./persistence";
import type { Room } from "./rooms";

export const MESSAGE_SYNC = 0;

function updatesChannel(documentId: string): string {
  return `doc:${documentId}:updates`;
}

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

    // Only re-publish updates that originated locally (a client's edit on
    // THIS instance). An update we just received from Redis already came
    // from another instance's publish — republishing it would echo forever.
    if (origin !== RECV_FROM_REDIS) {
      void redisPub.publish(updatesChannel(room.documentId), Buffer.from(update));
    }

    scheduleSnapshot(room);
  });
}

/**
 * Subscribes this room to its Redis updates channel, so edits made on OTHER
 * instances get applied to this instance's Y.Doc — which in turn triggers
 * the broadcast above, fanning the update out to this instance's local
 * clients. Call once, at room creation (mirrors setupSyncBroadcast).
 */
export function setupRedisSyncSubscription(room: Room): void {
  subscribeChannel(updatesChannel(room.documentId), (payload) => {
    Y.applyUpdate(room.doc, new Uint8Array(payload), RECV_FROM_REDIS);
  });
}

export function teardownRedisSyncSubscription(room: Room): void {
  unsubscribeChannel(updatesChannel(room.documentId));
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
