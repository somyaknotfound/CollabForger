import { invokeAgentSchema } from "@collabforge/shared-types";
import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";

import { signAgentToken } from "../lib/jwt";
import { requireAuth } from "../middleware/auth";
import { AgentInvocation, type AgentInvocationDocument } from "../models/AgentInvocation";
import { Document } from "../models/Document";
import { redis } from "../config/redis";

// mergeParams is required because this router is mounted at a path
// containing a param ("/documents/:id/agent" in index.ts) — without it,
// Express resets req.params for the sub-router and req.params.id is empty.
const router: Router = Router({ mergeParams: true });

const AGENT_WORKER_URL = process.env.AGENT_WORKER_URL ?? "http://localhost:3004";
const RATE_LIMIT_PER_USER = Number(process.env.AGENT_RATE_LIMIT_PER_USER) || 5;
const RATE_LIMIT_GLOBAL = Number(process.env.AGENT_RATE_LIMIT_GLOBAL) || 15;

function toSummary(inv: AgentInvocationDocument) {
  return {
    id: inv._id.toString(),
    documentId: inv.documentId.toString(),
    invokedBy: inv.invokedBy.toString(),
    prompt: inv.prompt,
    toolCalls: inv.toolCalls.map((t) => ({
      tool: t.tool,
      input: t.input,
      output: t.output,
      isMcpTool: t.isMcpTool,
      timestamp: t.timestamp.toISOString(),
    })),
    status: inv.status,
    createdAt: inv.createdAt,
  };
}

// INCR+EXPIRE rather than a single SET — lets concurrent requests in the same
// minute all increment the same counter safely (EXPIRE is only set once, by
// whichever request happens to see count === 1, so the window doesn't reset
// on every request).
async function checkAndIncrRateLimit(key: string, limit: number): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, 60);
  }
  return count <= limit;
}

router.use(requireAuth);

router.post("/", async (req: Request, res: Response) => {
  const documentId = req.params.id;
  if (!mongoose.isValidObjectId(documentId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const parsed = invokeAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const userId = req.userId as string;

  const doc = await Document.findById(documentId);
  if (!doc || doc.isArchived) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const isOwner = doc.ownerId.toString() === userId;
  const isEditor = doc.collaborators.some((c) => c.userId.toString() === userId && c.role === "editor");
  if (!isOwner && !isEditor) {
    res.status(403).json({ error: "You need editor access to invoke the agent on this document" });
    return;
  }

  // Per-user cap first (cheap, specific feedback), then the global cap —
  // OpenRouter's free tier is 20 req/min per API key for the whole app, not
  // per user, so the global cap protects every other user from one person's
  // burst. See CLAUDE.md's Redis Role D.
  const minute = Math.floor(Date.now() / 60000);
  const withinUserLimit = await checkAndIncrRateLimit(`ratelimit:agent:${userId}:${minute}`, RATE_LIMIT_PER_USER);
  if (!withinUserLimit) {
    res.status(429).json({ error: "You're invoking the agent too often — try again in a minute" });
    return;
  }
  const withinGlobalLimit = await checkAndIncrRateLimit(`ratelimit:agent:global:${minute}`, RATE_LIMIT_GLOBAL);
  if (!withinGlobalLimit) {
    res.status(429).json({ error: "The agent is busy right now — try again in a minute" });
    return;
  }

  const invocation = await AgentInvocation.create({
    documentId,
    invokedBy: userId,
    prompt: parsed.data.prompt,
    toolCalls: [],
    status: "pending",
  });

  const token = signAgentToken(invocation._id.toString());

  try {
    const response = await fetch(`${AGENT_WORKER_URL}/invoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invocationId: invocation._id.toString(),
        documentId,
        prompt: parsed.data.prompt,
        token,
      }),
    });
    if (!response.ok) {
      throw new Error(`agent-worker responded ${response.status}`);
    }
  } catch {
    invocation.status = "error";
    await invocation.save();
    res.status(502).json({ error: "Could not reach the agent worker" });
    return;
  }

  res.status(202).json({ invocationId: invocation._id.toString() });
});

router.get("/", async (req: Request, res: Response) => {
  const documentId = req.params.id;
  if (!mongoose.isValidObjectId(documentId)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const userId = req.userId as string;

  const doc = await Document.findById(documentId);
  if (!doc || doc.isArchived) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const isOwner = doc.ownerId.toString() === userId;
  const isCollaborator = doc.collaborators.some((c) => c.userId.toString() === userId);
  if (!isOwner && !isCollaborator) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const invocations = await AgentInvocation.find({ documentId }).sort({ createdAt: -1 });
  res.json(invocations.map(toSummary));
});

export default router;
