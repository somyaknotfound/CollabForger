import crypto from "node:crypto";

import { loginSchema, registerSchema } from "@collabforge/shared-types";
import bcrypt from "bcrypt";
import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";

import { requireAuth } from "../middleware/auth";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../lib/jwt";
import { Session } from "../models/Session";
import { User, type UserDocument } from "../models/User";

const router: Router = Router();

const REFRESH_COOKIE_NAME = "refreshToken";
const REFRESH_COOKIE_PATH = "/auth";
const BCRYPT_ROUNDS = 12;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function tokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp: number };
  return new Date(decoded.exp * 1000);
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    expires: expiresAt,
    path: REFRESH_COOKIE_PATH,
  });
}

function toPublicUser(user: UserDocument) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

async function issueSession(userId: string, req: Request, res: Response): Promise<string> {
  const accessToken = signAccessToken(userId);
  const refreshToken = signRefreshToken(userId);
  const expiresAt = tokenExpiry(refreshToken);

  await Session.create({
    userId,
    refreshTokenHash: hashToken(refreshToken),
    userAgent: req.headers["user-agent"] ?? "unknown",
    ip: req.ip ?? "unknown",
    expiresAt,
  });

  setRefreshCookie(res, refreshToken, expiresAt);
  return accessToken;
}

router.post("/register", async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password, name } = parsed.data;

  const existing = await User.findOne({ email });
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await User.create({ email, passwordHash, name, avatarUrl: null });

  const accessToken = await issueSession(user._id.toString(), req, res);
  res.status(201).json({ accessToken, user: toPublicUser(user) });
});

router.post("/login", async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { email, password } = parsed.data;

  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const accessToken = await issueSession(user._id.toString(), req, res);
  res.json({ accessToken, user: toPublicUser(user) });
});

router.post("/refresh", async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Missing refresh token" });
    return;
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }

  const session = await Session.findOne({ userId: payload.sub, refreshTokenHash: hashToken(token) });

  if (!session) {
    // A validly-signed refresh token that doesn't match any stored session
    // means it was already rotated away — i.e. this is a replay of a stolen
    // token. Kill every session for this user rather than just this one.
    await Session.deleteMany({ userId: payload.sub });
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    res.status(401).json({ error: "Refresh token reuse detected — all sessions revoked" });
    return;
  }

  await session.deleteOne();
  const accessToken = await issueSession(payload.sub, req, res);
  res.json({ accessToken });
});

router.post("/logout", async (req: Request, res: Response) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (token) {
    await Session.deleteOne({ refreshTokenHash: hashToken(token) });
  }
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  res.status(204).send();
});

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(toPublicUser(user));
});

export default router;
