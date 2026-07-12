import { createDocumentSchema, updateDocumentSchema } from "@collabforge/shared-types";
import { Router, type Request, type Response } from "express";
import mongoose from "mongoose";

import { requireAuth } from "../middleware/auth";
import { Document, type DocumentDocument } from "../models/Document";

const router: Router = Router();

function toDocumentMeta(doc: DocumentDocument) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    ownerId: doc.ownerId.toString(),
    collaborators: doc.collaborators.map((c) => ({ userId: c.userId.toString(), role: c.role })),
    lastEditedAt: doc.lastEditedAt,
  };
}

function isOwner(doc: DocumentDocument, userId: string): boolean {
  return doc.ownerId.toString() === userId;
}

function isCollaborator(doc: DocumentDocument, userId: string): boolean {
  return doc.collaborators.some((c) => c.userId.toString() === userId);
}

router.use(requireAuth);

router.get("/", async (req: Request, res: Response) => {
  const userId = req.userId as string;

  const docs = await Document.find({
    isArchived: false,
    $or: [{ ownerId: userId }, { "collaborators.userId": userId }],
  }).sort({ lastEditedAt: -1 });

  res.json(docs.map(toDocumentMeta));
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = createDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const userId = req.userId as string;

  const doc = await Document.create({
    title: parsed.data.title,
    ownerId: userId,
    collaborators: [],
    lastEditedAt: new Date(),
    lastEditedBy: userId,
    isArchived: false,
  });

  res.status(201).json(toDocumentMeta(doc));
});

router.get("/:id", async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const userId = req.userId as string;

  const doc = await Document.findById(req.params.id);
  if (!doc || doc.isArchived) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!isOwner(doc, userId) && !isCollaborator(doc, userId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json(toDocumentMeta(doc));
});

router.patch("/:id", async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const parsed = updateDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { collaborators } = parsed.data;
  if (collaborators?.some((c) => !mongoose.isValidObjectId(c.userId))) {
    res.status(400).json({ error: "Invalid collaborator userId" });
    return;
  }

  const userId = req.userId as string;

  const doc = await Document.findById(req.params.id);
  if (!doc || doc.isArchived) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!isOwner(doc, userId)) {
    res.status(403).json({ error: "Only the owner can update this document" });
    return;
  }

  if (parsed.data.title !== undefined) {
    doc.title = parsed.data.title;
  }
  if (collaborators !== undefined) {
    doc.collaborators = collaborators.map((c) => ({
      userId: new mongoose.Types.ObjectId(c.userId),
      role: c.role,
      addedAt: new Date(),
    }));
  }
  doc.lastEditedAt = new Date();
  doc.lastEditedBy = new mongoose.Types.ObjectId(userId);

  await doc.save();
  res.json(toDocumentMeta(doc));
});

router.delete("/:id", async (req: Request, res: Response) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const userId = req.userId as string;

  const doc = await Document.findById(req.params.id);
  if (!doc || doc.isArchived) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!isOwner(doc, userId)) {
    res.status(403).json({ error: "Only the owner can delete this document" });
    return;
  }

  doc.isArchived = true;
  await doc.save();
  res.status(204).send();
});

export default router;
