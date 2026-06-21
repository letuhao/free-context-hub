"use client";

import type { ReactNode } from "react";

/**
 * Pre-auth visual chrome for the shell-less auth pages (/login, /register).
 *
 * IMPORTANT (§2.10): this component is ONLY the centered card chrome + ContextHub
 * brand mark for the auth flow. It does NOT and CANNOT suppress the inherited
 * `<Sidebar/>` rendered by the single root `gui/src/app/layout.tsx` — a Next.js
 * App Router child page can't hide a parent layout's shell. Sidebar suppression
 * is the integrator's `layout.tsx` gate (the frozen `PRE_AUTH_ROUTES` list).
 * This file only owns how the auth pages LOOK once that gate hides the sidebar.
 */
export function PreAuthShell({
  children,
  /** Optional notice rendered above the card (e.g. the auth-OFF banner). */
  banner,
}: {
  children: ReactNode;
  banner?: ReactNode;
}) {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-6 justify-center">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
            C
          </div>
          <span className="text-base font-semibold text-zinc-100">ContextHub</span>
        </div>
        {banner}
        {children}
        <p className="text-[11px] text-zinc-700 mt-6 text-center">
          Governance console · operator access only
        </p>
      </div>
    </div>
  );
}

/** A bordered card for one step of an auth flow. */
export function PreAuthCard({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: "default" | "warning";
  className?: string;
}) {
  const border = tone === "warning" ? "border-amber-500/20" : "border-zinc-800";
  return (
    <div
      className={`w-full bg-zinc-900 border ${border} rounded-xl shadow-2xl p-7 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
