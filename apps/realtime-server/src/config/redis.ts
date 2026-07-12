import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// ioredis: once a connection issues SUBSCRIBE it enters subscriber mode and
// can no longer run PUBLISH or other commands — hence two separate
// connections instead of one.
export const redisPub = new Redis(REDIS_URL);
export const redisSub = new Redis(REDIS_URL);

// Sentinel origin passed to Y.applyUpdate/applyAwarenessUpdate when applying
// something that arrived FROM Redis. sync.ts/awareness.ts check for it to
// avoid re-publishing a remote update back to Redis, which would echo
// forever between instances.
export const RECV_FROM_REDIS = Symbol("redis-applied-update");

// ioredis fires one process-wide 'messageBuffer' event for every subscribed
// channel, so a single subscriber connection can serve every room — this
// registry dispatches each incoming payload to the room that owns its
// channel. 'messageBuffer' (not the string 'message' event) is required
// because Yjs updates are binary; the string event would corrupt them via
// UTF-8 decoding.
type ChannelHandler = (payload: Buffer) => void;
const channelHandlers = new Map<string, ChannelHandler>();

redisSub.on("messageBuffer", (channel: Buffer, message: Buffer) => {
  channelHandlers.get(channel.toString())?.(message);
});

export function subscribeChannel(channel: string, handler: ChannelHandler): void {
  channelHandlers.set(channel, handler);
  void redisSub.subscribe(channel);
}

export function unsubscribeChannel(channel: string): void {
  channelHandlers.delete(channel);
  void redisSub.unsubscribe(channel);
}
