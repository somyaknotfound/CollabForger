"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { AgentInvocationSummary, DocumentMeta } from "@collabforge/shared-types";

import { apiFetch, useAuthStore } from "@/lib/authStore";
import { useRequireAuth } from "@/lib/useRequireAuth";

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "loaded"; doc: DocumentMeta };

function useAgentInvocations(documentId: string, enabled: boolean) {
  const [invocations, setInvocations] = useState<AgentInvocationSummary[]>([]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function poll() {
      try {
        const res = await apiFetch(`/documents/${documentId}/agent`);
        if (!cancelled && res.ok) {
          const data = (await res.json()) as AgentInvocationSummary[];
          setInvocations(data);
        }
      } catch {
        // Transient — the next tick will retry.
      }
    }

    void poll();
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [documentId, enabled]);

  return invocations;
}

export default function DocumentPage() {
  const params = useParams<{ id: string }>();
  const { checking, authenticated } = useRequireAuth();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const invocations = useAgentInvocations(params.id, state.status === "loaded");

  async function handleInvokeAgent(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiFetch(`/documents/${params.id}/agent`, {
        method: "POST",
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: unknown };
        const message = typeof data.error === "string" ? data.error : "Failed to invoke the agent";
        setSubmitError(message);
        return;
      }
      setPrompt("");
    } catch {
      setSubmitError("Failed to invoke the agent");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (checking || !authenticated) return;

    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch(`/documents/${params.id}`);
        if (cancelled) return;

        if (res.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (res.status === 404) {
          setState({ status: "not-found" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const doc = (await res.json()) as DocumentMeta;
        setState({ status: "loaded", doc });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.id, checking, authenticated]);

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  if (!authenticated) {
    return null;
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <div className="w-full max-w-2xl">
        <Link href="/dashboard" className="text-sm text-gray-500 underline">
          ← Back to dashboard
        </Link>

        {state.status === "loading" ? <p className="mt-6 text-sm text-gray-500">Loading document…</p> : null}

        {state.status === "forbidden" ? (
          <p className="mt-6 text-sm text-red-600">
            You don&apos;t have access to this document.
          </p>
        ) : null}

        {state.status === "not-found" ? (
          <p className="mt-6 text-sm text-red-600">This document doesn&apos;t exist.</p>
        ) : null}

        {state.status === "error" ? (
          <p className="mt-6 text-sm text-red-600">Something went wrong loading this document.</p>
        ) : null}

        {state.status === "loaded" ? (
          <div className="mt-6">
            <h1 className="text-3xl font-bold tracking-tight">{state.doc.title}</h1>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-gray-600">
              <dt className="font-medium text-gray-500">Owner</dt>
              <dd>{state.doc.ownerId === currentUserId ? "You" : state.doc.ownerId}</dd>
              <dt className="font-medium text-gray-500">Collaborators</dt>
              <dd>{state.doc.collaborators.length}</dd>
              <dt className="font-medium text-gray-500">Last edited</dt>
              <dd>{new Date(state.doc.lastEditedAt).toLocaleString()}</dd>
            </dl>

            <div className="mt-8 rounded border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
              This is a metadata shell. Live collaborative editing (Tiptap + Yjs) is a separate,
              not-yet-built piece — this page can invoke the AI agent, but you won&apos;t see its
              edits appear here yet.
            </div>

            <form onSubmit={handleInvokeAgent} className="mt-8">
              <label htmlFor="agent-prompt" className="block text-sm font-medium text-gray-700">
                Ask Electra
              </label>
              <textarea
                id="agent-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={submitting}
                rows={3}
                placeholder="e.g. Add a note that says the launch is delayed to Friday"
                className="mt-2 w-full rounded border border-gray-300 p-2 text-sm disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={submitting || !prompt.trim()}
                className="mt-2 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Invoke agent"}
              </button>
              {submitError ? <p className="mt-2 text-sm text-red-600">{submitError}</p> : null}
            </form>

            <div className="mt-8">
              <h2 className="text-sm font-medium text-gray-700">Agent activity</h2>
              {invocations.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No invocations yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-gray-200 rounded border border-gray-200">
                  {invocations.map((inv) => (
                    <li key={inv.id} className="p-3 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <span className="truncate">{inv.prompt}</span>
                        <span
                          className={
                            "shrink-0 rounded px-2 py-0.5 text-xs " +
                            (inv.status === "complete"
                              ? "bg-green-100 text-green-800"
                              : inv.status === "error"
                                ? "bg-red-100 text-red-800"
                                : "bg-gray-100 text-gray-600")
                          }
                        >
                          {inv.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {inv.toolCalls.length} tool call{inv.toolCalls.length === 1 ? "" : "s"} ·{" "}
                        {new Date(inv.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
