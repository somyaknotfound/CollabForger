import { Schema, model, type Document as MongooseDocument, type Types } from "mongoose";

interface NotionIntegration {
  accessToken: string;
  workspaceId: string;
  connectedAt: Date;
}

export interface UserDocument extends MongooseDocument {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string;
  name: string;
  avatarUrl: string | null;
  integrations: {
    notion?: NotionIntegration;
  };
  createdAt: Date;
  updatedAt: Date;
}

const notionIntegrationSchema = new Schema<NotionIntegration>(
  {
    accessToken: { type: String, required: true },
    workspaceId: { type: String, required: true },
    connectedAt: { type: Date, required: true },
  },
  { _id: false },
);

const userSchema = new Schema<UserDocument>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    avatarUrl: { type: String, default: null },
    integrations: {
      notion: { type: notionIntegrationSchema, required: false },
    },
  },
  { timestamps: true },
);

export const User = model<UserDocument>("User", userSchema);
