import { Schema, model } from "mongoose";

interface DocumentSnapshotFields {
  yjsState?: Buffer;
  yjsStateVersion: number;
  lastEditedAt: Date;
}

/**
 * A deliberately minimal view of api-server's Document collection. This
 * service only ever reads/writes yjsState, yjsStateVersion, and
 * lastEditedAt via targeted $set/$inc updates (see persistence.ts) — never
 * a full load-and-.save(), so it can't clobber fields it doesn't know about
 * (title, ownerId, collaborators, isArchived — those belong to api-server).
 * `strict: false` lets Mongoose read documents that have those extra fields
 * without stripping them.
 */
const documentSnapshotSchema = new Schema<DocumentSnapshotFields>(
  {
    yjsState: { type: Buffer, required: false },
    yjsStateVersion: { type: Number, default: 0 },
    lastEditedAt: { type: Date },
  },
  { strict: false },
);

export const DocumentSnapshot = model<DocumentSnapshotFields>("Document", documentSnapshotSchema);
