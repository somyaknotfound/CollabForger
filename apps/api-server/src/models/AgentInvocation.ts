import { Schema, model, type Document as MongooseDocument, type Types } from "mongoose";

export interface ToolCallSubdoc {
  tool: string;
  input: unknown;
  output: unknown;
  isMcpTool: boolean;
  timestamp: Date;
}

export interface AgentInvocationDocument extends MongooseDocument {
  _id: Types.ObjectId;
  documentId: Types.ObjectId;
  invokedBy: Types.ObjectId;
  prompt: string;
  toolCalls: ToolCallSubdoc[];
  status: "pending" | "streaming" | "complete" | "error";
  createdAt: Date;
}

const toolCallSchema = new Schema<ToolCallSubdoc>(
  {
    tool: { type: String, required: true },
    input: { type: Schema.Types.Mixed },
    output: { type: Schema.Types.Mixed },
    isMcpTool: { type: Boolean, required: true, default: false },
    timestamp: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const agentInvocationSchema = new Schema<AgentInvocationDocument>({
  documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true },
  invokedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  prompt: { type: String, required: true },
  toolCalls: { type: [toolCallSchema], default: [] },
  status: { type: String, enum: ["pending", "streaming", "complete", "error"], required: true, default: "pending" },
  createdAt: { type: Date, default: Date.now },
});

agentInvocationSchema.index({ documentId: 1, createdAt: -1 });

export const AgentInvocation = model<AgentInvocationDocument>("AgentInvocation", agentInvocationSchema);
