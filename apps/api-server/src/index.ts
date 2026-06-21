import cors from "cors";
import dotenv from "dotenv";
import express from "express";

import { connectDB } from "./config/db";
import { redis } from "./config/redis";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// TODO: Mount auth routes (e.g. app.use("/auth", authRoutes))

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
