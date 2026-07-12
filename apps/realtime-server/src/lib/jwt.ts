import jwt from "jsonwebtoken";

export interface AccessTokenPayload {
  sub: string;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET is not set");
  }
  return jwt.verify(token, secret) as AccessTokenPayload;
}
