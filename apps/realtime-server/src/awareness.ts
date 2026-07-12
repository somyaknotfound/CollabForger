import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket } from "ws";
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";

import type { Room } from "./rooms";

export const MESSAGE_AWARENESS = 1;

interface AwarenessChanges {
  added: number[];
  updated: number[];
  removed: number[];
}

function sendAwarenessUpdate(target: WebSocket, room: Room, clientIds: number[]): void {
  if (clientIds.length === 0) return;
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(room.awareness, clientIds));
  target.send(encoding.toUint8Array(encoder));
}

/**
 * Wires this room's Awareness instance so every change — a cursor moving, a
 * user going idle, someone disconnecting — gets broadcast to every OTHER
 * connected client. Also records which connection "owns" each clientID it
 * introduces, so cleanupConnectionAwareness knows what to remove when that
 * connection drops. Call once, at room creation.
 */
export function setupAwarenessBroadcast(room: Room): void {
  room.awareness.on("update", ({ added, updated, removed }: AwarenessChanges, origin: unknown) => {
    const originWs = origin instanceof WebSocket ? origin : undefined;

    if (originWs && room.clients.has(originWs)) {
      let owned = room.connectionAwarenessIds.get(originWs);
      if (!owned) {
        owned = new Set();
        room.connectionAwarenessIds.set(originWs, owned);
      }
      for (const clientId of added) owned.add(clientId);
    }

    const changedClientIds = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(room.awareness, changedClientIds));
    const message = encoding.toUint8Array(encoder);

    for (const client of room.clients) {
      if (client !== originWs && client.readyState === client.OPEN) {
        client.send(message);
      }
    }
  });
}

/**
 * Sent once, right when a client joins: the current presence of everyone
 * already in the room. Without this, a client joining mid-session would only
 * ever learn about FUTURE awareness changes, never who's already here.
 */
export function sendCurrentAwarenessStates(room: Room, ws: WebSocket): void {
  sendAwarenessUpdate(ws, room, Array.from(room.awareness.getStates().keys()));
}

export function handleAwarenessMessage(room: Room, ws: WebSocket, decoder: decoding.Decoder): void {
  const update = decoding.readVarUint8Array(decoder);
  applyAwarenessUpdate(room.awareness, update, ws);
}

/** Called on disconnect: removes whatever presence this connection owned. */
export function cleanupConnectionAwareness(room: Room, ws: WebSocket): void {
  const ownedClientIds = room.connectionAwarenessIds.get(ws);
  room.connectionAwarenessIds.delete(ws);
  if (ownedClientIds && ownedClientIds.size > 0) {
    removeAwarenessStates(room.awareness, Array.from(ownedClientIds), null);
  }
}
