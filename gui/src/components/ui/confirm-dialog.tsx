"use client";

import { useState, useEffect } from "react";
import { Button } from "./button";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmText?: string;
  confirmValue?: string;
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  confirmValue,
  destructive,
}: ConfirmDialogProps) {
  const [input, setInput] = useState("");
  const canConfirm = confirmValue ? input === confirmValue : true;

  useEffect(() => {
    if (open) setInput("");
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) {
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]" onClick={onClose} />
      <div className="relative w-[400px] bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl animate-[fadeInScale_0.2s_ease-out]">
        <h3 className="text-base font-semibold text-zinc-100 mb-2">{title}</h3>
        <p className="text-sm text-zinc-400 mb-4 leading-relaxed">{description}</p>

        {confirmValue && (
          <>
            <p className="text-xs text-zinc-500 mb-2">
              Type <strong className="text-red-400">{confirmValue}</strong> to confirm:
            </p>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-sm text-zinc-100 outline-none focus:border-zinc-600 mb-4"
              placeholder={confirmValue}
              autoFocus
            />
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={destructive ? "danger" : "primary"}
            onClick={() => { onConfirm(); onClose(); }}
            disabled={!canConfirm}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}
