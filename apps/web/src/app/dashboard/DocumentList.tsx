"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import type { DocumentMeta } from "@collabforge/shared-types";

import { apiFetch } from "@/lib/authStore";

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function DocumentList() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocumentMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch("/documents");
        if (!res.ok) {
          if (!cancelled) setError("Could not load your documents.");
          return;
        }
        const data = (await res.json()) as DocumentMeta[];
        if (!cancelled) setDocs(data);
      } catch {
        if (!cancelled) setError("Could not reach the server.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch("/documents", {
        method: "POST",
        body: JSON.stringify({ title }),
      });
      if (!res.ok) {
        setError("Could not create the document.");
        return;
      }
      const doc = (await res.json()) as DocumentMeta;
      router.push(`/documents/${doc.id}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="w-full max-w-2xl">
      <form onSubmit={handleCreate} className="mb-8 flex gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New document title"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating || newTitle.trim().length === 0}
          className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {creating ? "Creating…" : "New Document"}
        </button>
      </form>

      {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}

      {docs === null && !error ? <p className="text-sm text-gray-500">Loading documents…</p> : null}

      {docs !== null && docs.length === 0 ? (
        <p className="text-sm text-gray-500">
          You don&apos;t have any documents yet. Create one to get started.
        </p>
      ) : null}

      {docs !== null && docs.length > 0 ? (
        <ul className="divide-y divide-gray-200 rounded border border-gray-200">
          {docs.map((doc) => (
            <li key={doc.id}>
              <button
                type="button"
                onClick={() => router.push(`/documents/${doc.id}`)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
              >
                <span className="font-medium text-gray-900">{doc.title}</span>
                <span className="text-xs text-gray-400">{formatRelative(new Date(doc.lastEditedAt))}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
