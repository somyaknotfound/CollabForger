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
