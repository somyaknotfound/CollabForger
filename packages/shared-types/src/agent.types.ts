/**
 * AI agent invocation-related TypeScript interfaces for CollabForge.
 */

import { z } from "zod";

export type AgentInvocationStatus = "pending" | "streaming" | "complete" | "error";

export const invokeAgentSchema = z.object({
  prompt: z.string().min(1).max(2000),
});

export type InvokeAgentInput = z.infer<typeof invokeAgentSchema>;

export interface ToolCallRecord {
  tool: string;
  input: unknown;
  output: unknown;
  isMcpTool: boolean;
  timestamp: string;
}

export interface AgentInvocationSummary {
  id: string;
  documentId: string;
  invokedBy: string;
  prompt: string;
  toolCalls: ToolCallRecord[];
  status: AgentInvocationStatus;
  createdAt: Date;
}
