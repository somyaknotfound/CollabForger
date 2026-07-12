"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { DocumentMeta } from "@collabforge/shared-types";

import { apiFetch, useAuthStore } from "@/lib/authStore";
import { useRequireAuth } from "@/lib/useRequireAuth";

type LoadState =
  | { status: "loading" }
  | { status: "forbidden" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "loaded"; doc: DocumentMeta };

export default function DocumentPage() {
  const params = useParams<{ id: string }>();
  const { checking, authenticated } = useRequireAuth();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [state, setState] = useState<LoadState>({ status: "loading" });

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
              This is a metadata shell. Live collaborative editing (Tiptap + Yjs) arrives in Week 2.
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
