import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import mongoose from "mongoose";

import { runInvocation } from "./agentLoop";

dotenv.config();

const app = express();
app.use(express.json());
const port = Number(process.env.PORT) || 3004;

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

interface InvokeBody {
  invocationId?: string;
  documentId?: string;
  prompt?: string;
  token?: string;
}

app.post("/invoke", (req: Request, res: Response) => {
  const { invocationId, documentId, prompt, token } = req.body as InvokeBody;
  if (!invocationId || !documentId || !prompt || !token) {
    res.status(400).json({ error: "invocationId, documentId, prompt, and token are all required" });
    return;
  }

  res.status(202).json({ accepted: true });

  // Fire-and-forget: the response above has already gone out. Errors inside
  // runInvocation are caught internally and recorded on the AgentInvocation
  // document itself (status: "error") — there's no HTTP caller left to
  // report back to once we've responded 202.
  void runInvocation(invocationId, documentId, prompt, token);
});

async function start(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MongoDB connection failed: MONGODB_URI is not set");
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("MongoDB connected successfully");
  } catch (error) {
    console.error("MongoDB connection failed:", error);
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`Agent worker listening on port ${port}`);
  });
}

void start();
