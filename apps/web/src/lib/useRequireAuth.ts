"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { bootstrapSession, useAuthStore } from "./authStore";

/**
 * Guards a client component route: if there's no in-memory access token (e.g. a
 * fresh page load, since the token is never persisted), tries a silent refresh
 * against the httpOnly cookie before redirecting to /login.
 */
export function useRequireAuth(): { checking: boolean; authenticated: boolean } {
  const router = useRouter();
  const accessToken = useAuthStore((s) => s.accessToken);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (useAuthStore.getState().accessToken) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    void bootstrapSession().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        router.replace("/login");
        return;
      }
      setChecking(false);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return { checking, authenticated: !checking && Boolean(accessToken) };
}
