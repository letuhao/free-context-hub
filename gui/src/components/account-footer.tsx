"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "@/lib/authApi";
import { LogOut, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Sidebar account footer (DEFERRED-062 §1) — "signed in as {display_name}" + sign-out.
 *
 * Reads identity from GET /api/me (authApi.me) and signs out via POST /api/auth/logout
 * (authApi.logout, which clears the httpOnly session cookie server-side). Renders NOTHING
 * when no principal is bound — i.e. dev/auth-OFF or a not-signed-in session — so the only
 * time it appears is a real human session under the hardened (auth-ON) posture.
 */
export function AccountFooter({ showLabel }: { showLabel: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<{ authenticated: boolean; display_name?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((m) => { if (active) setMe(m); })
      .catch(() => { if (active) setMe(null); });
    return () => { active = false; };
  }, []);

  // No bound principal (auth-off / not signed in) → no account UI to show.
  if (!me?.authenticated) return null;

  const name = me.display_name?.trim() || "Account";

  const logout = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await authApi.logout();
    } catch {
      // Best-effort — navigate to /login regardless; the cookie is single-purpose and
      // a failed logout still lands the user on the login screen.
    }
    router.replace("/login");
  };

  if (!showLabel) {
    // Collapsed rail: a single sign-out icon (identity shown via title).
    return (
      <div className="border-t border-zinc-800 px-2 py-2 flex justify-center">
        <button
          onClick={logout}
          disabled={busy}
          title={`Sign out (${name})`}
          className="text-zinc-500 hover:text-zinc-200 disabled:opacity-50 p-1"
        >
          <LogOut size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-800 px-3 py-2.5 flex items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-zinc-300">
        <UserRound size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-zinc-200" title={name}>{name}</div>
        <div className="text-[10px] text-zinc-600">Signed in</div>
      </div>
      <button
        onClick={logout}
        disabled={busy}
        title="Sign out"
        className={cn(
          "shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200",
          busy && "opacity-50",
        )}
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}
