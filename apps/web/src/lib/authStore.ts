"use client";

import { create } from "zustand";
import type { User } from "@collabforge/shared-types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "formErrors" in err) {
      // zod .flatten() shape: { formErrors: string[], fieldErrors: {...} }
      const flat = err as { formErrors: string[]; fieldErrors: Record<string, string[] | undefined> };
      const fieldMsg = Object.values(flat.fieldErrors).flat().find(Boolean);
      return fieldMsg ?? flat.formErrors[0] ?? fallback;
    }
  }
  return fallback;
}

interface AuthState {
  accessToken: string | null;
  user: User | null;
  setAccessToken: (token: string | null) => void;
  setUser: (user: User | null) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAccessToken: (token) => set({ accessToken: token }),
  setUser: (user) => set({ user }),
  login: async (email, password) => {
    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuthRetry: true,
    });
    const data = (await res.json()) as { accessToken?: string; user?: User; error?: unknown };
    if (!res.ok) {
      throw new ApiError(res.status, data, extractErrorMessage(data, "Login failed"));
    }
    set({ accessToken: data.accessToken ?? null, user: data.user ?? null });
  },
  register: async (email, password, name) => {
    const res = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
      skipAuthRetry: true,
    });
    const data = (await res.json()) as { accessToken?: string; user?: User; error?: unknown };
    if (!res.ok) {
      throw new ApiError(res.status, data, extractErrorMessage(data, "Registration failed"));
    }
    set({ accessToken: data.accessToken ?? null, user: data.user ?? null });
  },
  logout: async () => {
    await apiFetch("/auth/logout", { method: "POST", skipAuthRetry: true }).catch(() => undefined);
    set({ accessToken: null, user: null });
  },
  clear: () => set({ accessToken: null, user: null }),
}));

interface ApiFetchOptions extends RequestInit {
  /** Skip the "401 -> silent refresh -> retry once" behavior (use for auth endpoints themselves). */
  skipAuthRetry?: boolean;
}

async function rawFetch(path: string, options: RequestInit): Promise<Response> {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });
}

// Ensures concurrent 401s only trigger one /auth/refresh call.
let refreshPromise: Promise<boolean> | null = null;

async function silentRefresh(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/refresh`, { method: "POST", credentials: "include" });
        if (!res.ok) return false;
        const data = (await res.json()) as { accessToken: string };
        useAuthStore.getState().setAccessToken(data.accessToken);
        return true;
      } catch {
        return false;
      }
    })();
  }
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * Fetch wrapper for the CollabForge API: prefixes NEXT_PUBLIC_API_URL, always sends
 * credentials, attaches the in-memory access token, and on a 401 attempts exactly one
 * silent refresh + retry before giving up (the caller is responsible for redirecting
 * to /login when this still fails).
 */
export async function apiFetch(path: string, options: ApiFetchOptions = {}): Promise<Response> {
  const { skipAuthRetry, ...rest } = options;
  const res = await rawFetch(path, rest);
  if (res.status !== 401 || skipAuthRetry) return res;

  const refreshed = await silentRefresh();
  if (!refreshed) {
    useAuthStore.getState().clear();
    return res;
  }
  return rawFetch(path, rest);
}

/**
 * Attempts to hydrate a session purely from the httpOnly refresh cookie — used on
 * first mount of protected pages, since the access token lives only in memory and
 * is lost on a full page reload.
 */
export async function bootstrapSession(): Promise<boolean> {
  const refreshed = await silentRefresh();
  if (!refreshed) return false;

  const res = await apiFetch("/auth/me", { skipAuthRetry: true });
  if (!res.ok) {
    useAuthStore.getState().clear();
    return false;
  }
  const user = (await res.json()) as User;
  useAuthStore.getState().setUser(user);
  return true;
}
