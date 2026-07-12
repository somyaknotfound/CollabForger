import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import { connectDB } from "./config/db";
import { redis } from "./config/redis";
import authRoutes from "./routes/auth";
import documentRoutes from "./routes/documents";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

// credentials: true + an explicit origin are required together — the
// refresh token travels as an httpOnly cookie, which browsers refuse to
// send cross-origin under a wildcard '*' CORS origin.
app.use(cors({ origin: process.env.CORS_ORIGIN ?? "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/documents", documentRoutes);

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

  try {
    await new Promise<void>((resolve, reject) => {
      if (redis.status === "ready") {
        resolve();
        return;
      }

      redis.once("ready", () => resolve());
      redis.once("error", (err) => reject(err));
    });
    console.log("Redis connected successfully");
  } catch (error) {
    console.error("Redis connection failed:", error);
    process.exit(1);
  }

  app.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });
}

void start();
