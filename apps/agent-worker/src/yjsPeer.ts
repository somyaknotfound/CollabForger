import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import WebSocket from "ws";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// Sentinel origin for anything applied FROM the WS connection (remote), so
// this peer's own doc.on('update')/awareness.on('update') handlers don't
// echo it straight back to the server it just came from.
const REMOTE_ORIGIN = Symbol("remote");

export interface YjsPeer {
  doc: Y.Doc;
  /** null clears presence (the agent has left/finished). */
  setAwarenessState(state: Record<string, unknown> | null): void;
  close(): void;
}

const REALTIME_WS_URL = process.env.REALTIME_WS_URL ?? "ws://localhost:8080";

/**
 * Joins a document room the same way any human client does: same sync/
 * awareness wire protocol as apps/realtime-server's src/sync.ts and
 * src/awareness.ts. The agent is not a special case on the wire — it's just
 * another WebSocket peer authenticated with the agent-scoped token
 * api-server minted for this invocation.
 */
export function connectToRoom(documentId: string, token: string): Promise<YjsPeer> {
  return new Promise((resolve, reject) => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const ws = new WebSocket(`${REALTIME_WS_URL}/${documentId}?token=${token}`);

    let settled = false;

    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      ws.send(encoding.toUint8Array(encoder));
    });

    awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        if (origin === REMOTE_ORIGIN) return;
        const changedIds = added.concat(updated, removed);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, changedIds));
        ws.send(encoding.toUint8Array(encoder));
      },
    );

    ws.on("message", (data: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(decoder);

      if (type === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, REMOTE_ORIGIN);
        if (encoding.length(encoder) > 1) ws.send(encoding.toUint8Array(encoder));
      } else if (type === MESSAGE_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        applyAwarenessUpdate(awareness, update, REMOTE_ORIGIN);
      }
    });

    ws.on("open", () => {
      settled = true;
      resolve({
        doc,
        setAwarenessState(state) {
          awareness.setLocalState(state);
        },
        close() {
          awareness.setLocalState(null);
          ws.close();
        },
      });
    });

    ws.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    ws.on("close", () => {
      if (!settled) {
        settled = true;
        reject(new Error(`WebSocket to realtime-server closed before the sync handshake completed`));
      }
    });
  });
}
