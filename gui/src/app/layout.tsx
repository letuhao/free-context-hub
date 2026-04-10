import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ProjectProvider } from "@/contexts/project-context";
import { ToastProvider } from "@/components/ui/toast";
import { Sidebar } from "@/components/sidebar";
import { KeyboardShortcutsTrigger } from "@/components/keyboard-shortcuts-trigger";
import { CommandPalette } from "@/components/ui/command-palette";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      className={`${geistSans.variable} ${geistMono.variable} h-full dark`}
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
