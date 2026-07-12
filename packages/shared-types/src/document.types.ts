/**
 * Document-related TypeScript interfaces for CollabForge.
 */

import { z } from "zod";

export type CollaboratorRole = "editor" | "viewer";

export interface DocumentMeta {
  id: string;
  title: string;
  ownerId: string;
  collaborators: Array<{ userId: string; role: CollaboratorRole }>;
  lastEditedAt: Date;
}

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(200),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  collaborators: z
    .array(
      z.object({
        userId: z.string(),
        role: z.enum(["editor", "viewer"]),
      }),
    )
    .optional(),
});

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
