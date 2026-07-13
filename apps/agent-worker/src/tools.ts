import { tool } from "@openrouter/agent";
import { z } from "zod";

import type { YjsPeer } from "./yjsPeer";

export interface ExecutedToolCall {
  tool: string;
  input: unknown;
  output: unknown;
  isMcpTool: boolean;
  timestamp: Date;
}

/**
 * The one tool this first slice supports: append text to the document.
 * Content lives in a plain Y.Text at ydoc.getText("content") — a placeholder
 * convention until a real Tiptap/y-prosemirror binding exists (that binds to
 * a Y.XmlFragment instead, not a Y.Text, so this will need to migrate then).
 *
 * onToolCall is awaited before execute() returns, so the caller can persist
 * the audit trail (AgentInvocation.toolCalls[]) for THIS call before the
 * model can request another one — keeps the record append-only and ordered
 * even if a later tool call in the same invocation fails.
 */
export function createTools(peer: YjsPeer, onToolCall: (call: ExecutedToolCall) => Promise<void>) {
  const insertText = tool({
    name: "insertText",
    description: "Append text to the end of the shared document's content.",
    inputSchema: z.object({ text: z.string().min(1) }),
    execute: async ({ text }: { text: string }) => {
      const ytext = peer.doc.getText("content");
      ytext.insert(ytext.length, text);
      const output = { insertedLength: text.length, documentLength: ytext.length };

      await onToolCall({
        tool: "insertText",
        input: { text },
        output,
        isMcpTool: false,
        timestamp: new Date(),
      });

      return output;
    },
  });

  return [insertText] as const;
}
