import { callModel, stepCountIs } from "@openrouter/agent";
import { OpenRouter } from "@openrouter/sdk";

import { AgentInvocation } from "./models/AgentInvocation";
import { createTools } from "./tools";
import { connectToRoom, type YjsPeer } from "./yjsPeer";

const client = new OpenRouter({ apiKey: process.env.OPENROUTER_API_KEY ?? "" });
const MODEL = process.env.OPENROUTER_MODEL ?? "poolside/laguna-m.1:free";

const SYSTEM_PROMPT =
  "You are Electra, an AI collaborator embedded in a real-time document editor. " +
  "You can see the document's current content below and make edits using the insertText tool. " +
  "Be concise and only make the edit the request actually asks for.";

/**
 * Runs one agent invocation end to end: joins the document's Yjs room as a
 * peer, runs the OpenRouter tool-call loop, and updates the AgentInvocation
 * audit trail as it goes (not just at the end) — so a mid-loop crash still
 * leaves a correct partial record. Each tool call is its own atomic Yjs
 * transaction (see tools.ts), so a later tool call failing never corrupts or
 * rolls back an earlier one that already succeeded and broadcast.
 */
export async function runInvocation(
  invocationId: string,
  documentId: string,
  prompt: string,
  token: string,
): Promise<void> {
  const invocation = await AgentInvocation.findById(invocationId);
  if (!invocation) {
    console.error(`agent invocation ${invocationId} not found — nothing to run`);
    return;
  }

  let peer: YjsPeer | undefined;
  try {
    invocation.status = "streaming";
    await invocation.save();

    peer = await connectToRoom(documentId, token);
    peer.setAwarenessState({ status: "agent-thinking" });

    const tools = createTools(peer, async (call) => {
      peer!.setAwarenessState({ status: "composing" });
      invocation.toolCalls.push(call);
      await invocation.save();
    });

    const currentContent = peer.doc.getText("content").toString();
    const input =
      `${SYSTEM_PROMPT}\n\n` +
      `Current document content:\n"""\n${currentContent}\n"""\n\n` +
      `Request: ${prompt}`;

    const result = callModel(client, {
      model: MODEL,
      input,
      tools,
      stopWhen: stepCountIs(5),
    });

    await result.getText();

    invocation.status = "complete";
    await invocation.save();
  } catch (err) {
    console.error(`agent invocation ${invocationId} failed:`, err);
    invocation.status = "error";
    await invocation.save().catch((saveErr: unknown) => {
      console.error(`failed to persist error status for invocation ${invocationId}:`, saveErr);
    });
  } finally {
    if (peer) {
      peer.setAwarenessState(null);
      peer.close();
    }
  }
}
