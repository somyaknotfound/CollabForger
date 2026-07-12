import { Schema, model, type Document as MongooseDocument, type Types } from "mongoose";

export interface CollaboratorSubdoc {
  userId: Types.ObjectId;
  role: "editor" | "viewer";
  addedAt: Date;
}

export interface DocumentDocument extends MongooseDocument {
  _id: Types.ObjectId;
  title: string;
  ownerId: Types.ObjectId;
  collaborators: CollaboratorSubdoc[];
  yjsState?: Buffer;
  yjsStateVersion: number;
  lastEditedAt: Date;
  lastEditedBy: Types.ObjectId;
  isArchived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const collaboratorSchema = new Schema<CollaboratorSubdoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["editor", "viewer"], required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const documentSchema = new Schema<DocumentDocument>(
  {
    title: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    collaborators: { type: [collaboratorSchema], default: [] },
    yjsState: { type: Buffer, required: false },
    yjsStateVersion: { type: Number, default: 0 },
    lastEditedAt: { type: Date, required: true },
    lastEditedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

documentSchema.index({ "collaborators.userId": 1 });
documentSchema.index({ lastEditedAt: -1 });

export const Document = model<DocumentDocument>("Document", documentSchema);
