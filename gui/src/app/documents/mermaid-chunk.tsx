"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";

interface MermaidChunkProps {
  code: string;
}

/**
 * Render a mermaid diagram. Extracts the ```mermaid fenced block from
 * the chunk content, renders it via the mermaid npm package, and falls
 * back to a syntax-error display if parsing fails.
 */
export function MermaidChunk({ code }: MermaidChunkProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mmd-${Math.random().toString(36).slice(2, 10)}`);

  // Extract ```mermaid ... ``` block — fall back to raw content if none
  const source = extractMermaidSource(code);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          securityLevel: "strict",
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
        });
        const { svg } = await mermaid.render(idRef.current, source);
        if (!cancelled && hostRef.current) {
          hostRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to render diagram");
      }
    })();

    return () => { cancelled = true; };
  }, [source]);

  if (error) {
    return (
      <div className="space-y-3">
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-amber-300 font-medium mb-0.5">Mermaid syntax error</p>
            <p className="text-[11px] text-zinc-500 break-words">{error}</p>
            <p className="text-[10px] text-zinc-600 mt-1">
              Use "Edit" to fix the diagram source, or "Re-extract as Mermaid" to ask the vision model to try again.
            </p>
          </div>
        </div>
        <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed bg-zinc-950/50 p-3 rounded">
          {source}
        </pre>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        ref={hostRef}
        className="bg-zinc-950/50 p-4 rounded border border-zinc-800 overflow-x-auto flex justify-center [&_svg]:max-w-full [&_svg]:h-auto"
      />
      <details className="text-[10px] text-zinc-600">
        <summary className="cursor-pointer hover:text-zinc-400">View source</summary>
        <pre className="mt-2 text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed bg-zinc-950/50 p-3 rounded">
          {source}
        </pre>
      </details>
    </div>
  );
}

function extractMermaidSource(content: string): string {
  const match = content.match(/```mermaid\s*\n([\s\S]*?)```/);
  if (match) return match[1].trim();
  return content.trim();
}
