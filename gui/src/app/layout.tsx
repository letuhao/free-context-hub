import type { Metadata } from "next";
// Phase 13 longrun (DEFERRED-005 fix): switched from next/font/google to the
// official `geist` npm package. next/font/google requires network access to
// fonts.gstatic.com at build time; the build host can't reach it in some
// environments, breaking the production build. `geist` ships the font files
// locally, making the build network-independent.
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ProjectProvider } from "@/contexts/project-context";
import { ToastProvider } from "@/components/ui/toast";
import { Sidebar } from "@/components/sidebar";
import { KeyboardShortcutsTrigger } from "@/components/keyboard-shortcuts-trigger";
import { CommandPalette } from "@/components/ui/command-palette";
import "./globals.css";

export const metadata: Metadata = {
  title: "ContextHub",
  description: "Self-hosted knowledge dashboard for AI agents",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} h-full dark`}
    >
      <body className="h-screen overflow-hidden flex bg-zinc-950 text-zinc-100 font-[family-name:var(--font-geist-sans)]">
        <ProjectProvider>
          <ToastProvider>
            <Sidebar />
            <main className="flex-1 flex flex-col min-h-0 pt-12 md:pt-0">{children}</main>
            <KeyboardShortcutsTrigger />
            <CommandPalette />
          </ToastProvider>
        </ProjectProvider>
      </body>
    </html>
  );
}
