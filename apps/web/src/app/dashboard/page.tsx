"use client";

import { useRouter } from "next/navigation";

import { useAuthStore } from "@/lib/authStore";
import { useRequireAuth } from "@/lib/useRequireAuth";

import { DocumentList } from "./DocumentList";

export default function DashboardPage() {
  const router = useRouter();
  const { checking, authenticated } = useRequireAuth();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

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

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  return (
    <main className="flex min-h-screen flex-col items-center p-24">
      <div className="flex w-full max-w-2xl items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Documents</h1>
          {user ? <p className="mt-1 text-sm text-gray-500">Signed in as {user.email}</p> : null}
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="rounded border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Log out
        </button>
      </div>

      <div className="mt-8 w-full max-w-2xl">
        <DocumentList />
      </div>
    </main>
  );
}
