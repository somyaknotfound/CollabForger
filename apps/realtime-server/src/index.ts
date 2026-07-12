import http from "node:http";
import type { Duplex } from "node:stream";
import { URL } from "node:url";

import dotenv from "dotenv";
import * as decoding from "lib0/decoding";
import { WebSocketServer, type WebSocket } from "ws";

import {
  MESSAGE_AWARENESS,
  cleanupConnectionAwareness,
  handleAwarenessMessage,
  sendCurrentAwarenessStates,
} from "./awareness";
import { connectDB } from "./config/db";
import { verifyAccessToken } from "./lib/jwt";
import { destroyRoom, getOrCreateRoom, roomCount } from "./rooms";
import { MESSAGE_SYNC, handleSyncMessage, sendSyncStep1 } from "./sync";

dotenv.config();

const port = Number(process.env.PORT) || 3002;

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: roomCount() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

function rejectUpgrade(socket: Duplex, statusLine: string): void {
  socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n`);
  socket.destroy();
}

// Auth happens here, before the WS handshake completes — a bad/missing
// token gets a clean HTTP 401 on the upgrade request instead of a WS
// connection that opens and is immediately closed.
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const documentId = url.pathname.slice(1);
  const token = url.searchParams.get("token");

  if (!documentId) {
    rejectUpgrade(socket, "400 Bad Request");
    return;
  }
  if (!token) {
    rejectUpgrade(socket, "401 Unauthorized");
    return;
  }

  let userId: string;
  try {
    userId = verifyAccessToken(token).sub;
  } catch {
    rejectUpgrade(socket, "401 Unauthorized");
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
    handleConnection(ws, documentId, userId).catch((err: unknown) => {
      console.error(`failed to join room ${documentId} for user ${userId}:`, err);
      ws.close();
    });
  });
});

async function handleConnection(ws: WebSocket, documentId: string, userId: string): Promise<void> {
  const room = await getOrCreateRoom(documentId);
  room.clients.add(ws);
  console.log(`user ${userId} joined room ${documentId} (${room.clients.size} client(s))`);

  // Ask the new client what it has that we don't. The client asks the same
  // question back on its own connect — see src/sync.ts for why both
  // directions of this handshake are necessary.
  sendSyncStep1(room, ws);

  // Presence works differently: it has no "state vector" to diff against, so
  // a joining client needs an explicit snapshot of who's already here.
  sendCurrentAwarenessStates(room, ws);

  ws.on("message", (data, isBinary) => {
    if (!isBinary || !Buffer.isBuffer(data)) {
      console.warn(`ignoring non-binary message from user ${userId} in room ${documentId}`);
      return;
    }

    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case MESSAGE_SYNC:
        handleSyncMessage(room, ws, decoder);
        break;
      case MESSAGE_AWARENESS:
        handleAwarenessMessage(room, ws, decoder);
        break;
      default:
        console.warn(`unhandled message type ${messageType} from user ${userId} in room ${documentId}`);
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    cleanupConnectionAwareness(room, ws);
    console.log(`user ${userId} left room ${documentId} (${room.clients.size} client(s))`);
    if (room.clients.size === 0) {
      // Not awaited — this is an event handler with nothing to return to.
      // destroyRoom flushes a final snapshot before tearing the room down;
      // errors are already logged inside persistence.ts.
      void destroyRoom(documentId);
    }
  });

  ws.on("error", (err) => {
    console.error(`socket error for user ${userId} in room ${documentId}:`, err);
  });
}

async function start(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MongoDB connection failed: MONGODB_URI is not set");
    process.exit(1);
  }

  try {
    await connectDB(mongoUri);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }

  server.listen(port, () => {
    console.log(`Realtime server listening on port ${port}`);
  });
}

void start();
