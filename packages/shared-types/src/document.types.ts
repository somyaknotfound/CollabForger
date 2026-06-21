/**
 * Document-related TypeScript interfaces for CollabForge.
 * No runtime implementation — types only.
 */

export type CollaboratorRole = "editor" | "viewer";

export interface DocumentMeta {
  id: string;
  title: string;
  ownerId: string;
  collaborators: Array<{ userId: string; role: CollaboratorRole }>;
  lastEditedAt: Date;
}
