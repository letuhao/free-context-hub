"use client";

/**
 * FIX-5 — GUI auth gate + identity context.
 *
 * The hardened backend (MCP_AUTH_ENABLED=true) 401s every `/api/*` call without a session.
 * The whole human-login stack already exists (`/login`, `authApi`, httpOnly session cookie),
 * but nothing redirected an unauthenticated visitor TO `/login` — a protected page just
 * rendered full chrome and let its data calls 401 silently (degrading to a misleading
 * "create your first project"). This gate closes that gap: it resolves identity once via
 * GET /api/me and either renders, bounces to `/login`, or shows a transient-error retry.
 *
 * It ALSO publishes the resolved identity (principal_id / display_name / role) so downstream
 * coordination/governance surfaces can default "acting as" fields to the logged-in principal
 * and resolve actor UUIDs → display names (W2) instead of forcing humans to paste UUIDs.
 *
 * Auth-OFF (dev) is unchanged: /api/me returns `auth_enabled:false`, the gate renders, and
 * identity is simply absent (no principal to act as).
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authApi, AuthApiError, type AuthMe } from "@/lib/authApi";

export type GateDecision = "render" | "login" | "error";

/**
 * Pure decision core (unit-tested). Given the resolved /api/me view (or null + the thrown
 * error), decide what the gate should do. Kept side-effect-free so the matrix is testable
 * without React/router.
 */
export function decideGate(me: AuthMe | null, err: unknown): GateDecision {
  if (me) {
    if (!me.auth_enabled) return "render"; // dev / auth-OFF — no login required
    if (me.authenticated) return "render"; // signed-in human session
    return "login"; // enforced but no bound principal → must sign in
  }
  // me failed to resolve — err is set.
  if (err instanceof AuthApiError && err.status === 401) return "login";
  return "error"; // 5xx / network — surface a retry, never redirect-loop
}

interface AuthContextValue {
  me: AuthMe | null;
  /** Re-resolve identity (e.g. after a transient error retry). */
  refresh: () => void;
}

const AuthContext = createContext<AuthContextValue>({ me: null, refresh: () => {} });

/** The resolved identity for downstream UI (W2). Null in dev/auth-OFF or before resolve. */
export function useAuthIdentity(): AuthMe | null {
  return useContext(AuthContext).me;
}

/**
 * W2.1 — an "acting as" actor field that defaults to the logged-in principal once identity
 * resolves, but stays user-editable (acting on behalf of another actor is still possible).
 * Returns [value, setValue]. In dev/auth-OFF (no principal) it's simply empty.
 */
export function useActingActor(): [string, (v: string) => void] {
  const me = useContext(AuthContext).me;
  const [actor, setActor] = useState("");
  useEffect(() => {
    if (me?.principal_id) setActor((cur) => cur || me.principal_id!);
  }, [me?.principal_id]);
  return [actor, setActor];
}

function FullScreenSpinner({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center min-h-[60vh]">
      <div className="flex flex-col items-center gap-3 text-zinc-500">
        <div className="h-6 w-6 rounded-full border-2 border-zinc-700 border-t-zinc-300 animate-spin" />
        <span className="text-xs">{label}</span>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<AuthMe | null>(null);
  const [decision, setDecision] = useState<GateDecision | "loading">("loading");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let active = true;
    setDecision("loading");
    authApi
      .me()
      .then((resolved) => {
        if (!active) return;
        const d = decideGate(resolved, null);
        setMe(d === "render" ? resolved : null);
        setDecision(d);
      })
      .catch((err) => {
        if (!active) return;
        setMe(null);
        setDecision(decideGate(null, err));
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  // Redirect as a side-effect of the decision (not during render).
  useEffect(() => {
    if (decision === "login") {
      const next = encodeURIComponent(pathname || "/");
      router.replace(`/login?next=${next}`);
    }
  }, [decision, pathname, router]);

  if (decision === "loading") return <FullScreenSpinner label="Checking your session…" />;
  if (decision === "login") return <FullScreenSpinner label="Redirecting to sign-in…" />;
  if (decision === "error") {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh] px-6">
        <div className="max-w-sm text-center">
          <p className="text-sm text-zinc-300 mb-1">Couldn&apos;t reach the server</p>
          <p className="text-xs text-zinc-600 mb-4">
            The backend didn&apos;t respond. Check that the stack is running, then retry.
          </p>
          <button
            onClick={() => setNonce((n) => n + 1)}
            className="px-4 py-1.5 text-sm rounded-md border border-zinc-700 text-zinc-200 hover:border-zinc-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ me, refresh: () => setNonce((n) => n + 1) }}>
      {children}
    </AuthContext.Provider>
  );
}
