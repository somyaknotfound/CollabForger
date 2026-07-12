import { randomUUID } from "node:crypto";

// One per process, generated at startup. Used for log lines and as the
// snapshot-lock token (see persistence.ts) — NOT for Redis echo prevention,
// that's RECV_FROM_REDIS in config/redis.ts.
export const INSTANCE_ID = randomUUID();
