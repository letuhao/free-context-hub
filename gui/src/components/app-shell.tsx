"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { KeyboardShortcutsTrigger } from "@/components/keyboard-shortcuts-trigger";
import { CommandPalette } from "@/components/ui/command-palette";

// Actor Data Boundary completion (warp §2.10). A child page cannot remove a parent
// layout's chrome in the App Router, so the pre-auth shell gate lives here: routes in
// PRE_AUTH_ROUTES render shell-less (no Sidebar / command palette), everything else gets
// the full app chrome. usePathname is prerendered on first paint (page routes are not
// rewritten — see next.config.ts), so there is no sidebar flash on /login.
const PRE_AUTH_ROUTES = ["/login", "/register", "/bootstrap"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPreAuth = PRE_AUTH_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/"),
  );

  if (isPreAuth) {
    return <main className="flex-1 flex flex-col min-h-0">{children}</main>;
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 flex flex-col min-h-0 pt-12 md:pt-0">{children}</main>
      <KeyboardShortcutsTrigger />
      <CommandPalette />
    </>
  );
}
