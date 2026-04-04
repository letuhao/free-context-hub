"use client";

import { useState, useEffect } from "react";
import { KeyboardShortcuts } from "@/components/ui/keyboard-shortcuts";

export function KeyboardShortcutsTrigger() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Only trigger on "?" when not in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  return <KeyboardShortcuts open={open} onClose={() => setOpen(false)} />;
}
