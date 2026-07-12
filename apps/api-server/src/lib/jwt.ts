import jwt, { type SignOptions } from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function ttl(envVar: string, fallback: string): NonNullable<SignOptions["expiresIn"]> {
  return (process.env[envVar] ?? fallback) as NonNullable<SignOptions["expiresIn"]>;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, requireEnv("JWT_ACCESS_SECRET"), {
    expiresIn: ttl("JWT_ACCESS_TTL", "15m"),
  });
}

// Signs a short-lived token for the agent process itself to join a document's
// Yjs room as a peer — realtime-server verifies it with the same
// JWT_ACCESS_SECRET as any user token, it just carries a synthetic sub
// ("agent:<invocationId>") instead of a real User _id. 5 minutes is enough
// for one invocation's tool-call loop; the token isn't reused across invocations.
export function signAgentToken(invocationId: string): string {
  return jwt.sign({ sub: `agent:${invocationId}` }, requireEnv("JWT_ACCESS_SECRET"), {
    expiresIn: "5m",
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, requireEnv("JWT_ACCESS_SECRET")) as AccessTokenPayload;
}

export function signRefreshToken(userId: string): string {
  return jwt.sign({ sub: userId }, requireEnv("JWT_REFRESH_SECRET"), {
    expiresIn: ttl("JWT_REFRESH_TTL", "7d"),
  });
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, requireEnv("JWT_REFRESH_SECRET")) as AccessTokenPayload;
}
