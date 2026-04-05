"use client";

import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/cn";
import {
  Bold, Italic, Code, Heading1, List, Link2, SquareCode, Table,
} from "lucide-react";

interface RichEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  showToolbar?: boolean;
  showPreview?: boolean;
}

type ViewMode = "edit" | "preview" | "split";

/** Insert markdown syntax around the selection or at cursor position. */
function insertMarkdown(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  onChange: (v: string) => void,
) {
  const { selectionStart, selectionEnd, value } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);
  const replacement = `${before}${selected || "text"}${after}`;
  const newValue = value.slice(0, selectionStart) + replacement + value.slice(selectionEnd);
  onChange(newValue);

  // Restore cursor position after React re-render
  requestAnimationFrame(() => {
    const cursorPos = selected
      ? selectionStart + replacement.length
      : selectionStart + before.length;
    textarea.selectionStart = cursorPos;
    textarea.selectionEnd = selected ? cursorPos : cursorPos + ("text".length);
    textarea.focus();
  });
}

/** Insert markdown at the beginning of the current line. */
function insertLinePrefix(
  textarea: HTMLTextAreaElement,
  prefix: string,
  onChange: (v: string) => void,
) {
  const { selectionStart, value } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart);
  onChange(newValue);

  requestAnimationFrame(() => {
    textarea.selectionStart = textarea.selectionEnd = selectionStart + prefix.length;
    textarea.focus();
  });
}

/** Simple markdown to HTML for preview. */
function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks (must be before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-zinc-950 border border-zinc-800 rounded-md p-3 my-2 text-xs font-mono overflow-x-auto"><code>$2</code></pre>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-xs font-semibold text-zinc-200 mt-3 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-sm font-semibold text-zinc-200 mt-3 mb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-base font-semibold text-zinc-200 mt-3 mb-1">$1</h1>');

  // Bold / Italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-zinc-200">$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1 py-0.5 rounded text-[11px] font-mono text-zinc-300">$1</code>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-400 hover:underline">$1</a>');

  // Bullet lists
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(/(<li[^>]*>.*<\/li>\n?)+/g, '<ul class="space-y-0.5 my-1">$&</ul>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p class="my-1.5">');
  html = `<p class="my-1.5">${html}</p>`;

  return html;
}

const TOOLBAR_ACTIONS = [
  { icon: Bold, label: "Bold (Ctrl+B)", action: (ta: HTMLTextAreaElement, fn: (v: string) => void) => insertMarkdown(ta, "**", "**", fn) },
  { icon: Italic, label: "Italic (Ctrl+I)", action: (ta: HTMLTextAreaElement, fn: (v: string) => void) => insertMarkdown(ta, "*", "*", fn) },
  { icon: Code, label: "Inline Code", action: (ta: HTMLTextAreaElement, fn: (v: string) => void) => insertMarkdown(ta, "`", "`", fn) },
  { separator: true },
  { icon: Heading1, label: "Heading", action: (ta: HTMLTextAreaElement, fn: (v: string) => void) => insertLinePrefix(ta, "## ", fn) },
  { icon: List, label: "Bullet List", action: (ta: HTMLTextAreaElement, fn: (v: string) => void) => insertLinePrefix(ta, "- ", fn) },
  { icon: Link2, label: "Link", action: (ta: HTMLTextAreaElement, fn: (v: string) => void) => insertMarkdown(ta, "[", "](url)", fn) },
  { icon: SquareCode, label: "Code Block", action: (ta: HTMLTextAreaElement, fn: (v: string) => void) => insertMarkdown(ta, "```\n", "\n```", fn) },
] as const;

export function RichEditor({
  value,
  onChange,
  placeholder = "Write markdown content...",
  minHeight = 200,
  showToolbar = true,
  showPreview = true,
}: RichEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!textareaRef.current) return;
    const ta = textareaRef.current;

    if ((e.ctrlKey || e.metaKey) && e.key === "b") {
      e.preventDefault();
      insertMarkdown(ta, "**", "**", onChange);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "i") {
      e.preventDefault();
      insertMarkdown(ta, "*", "*", onChange);
    }
  }, [onChange]);

  const editorArea = (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className="w-full p-4 bg-transparent text-sm text-zinc-200 font-mono leading-relaxed outline-none resize-y placeholder:text-zinc-600"
      style={{ minHeight }}
    />
  );

  const previewArea = (
    <div
      className="p-4 text-xs text-zinc-400 leading-relaxed overflow-y-auto prose-invert"
      style={{ minHeight }}
      dangerouslySetInnerHTML={{ __html: value ? renderMarkdown(value) : `<span class="text-zinc-700 italic">Nothing to preview</span>` }}
    />
  );

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {/* Toolbar */}
      {showToolbar && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-zinc-800">
          {viewMode !== "preview" && TOOLBAR_ACTIONS.map((item, i) => {
            if ("separator" in item) {
              return <div key={i} className="w-px h-4 bg-zinc-800 mx-1" />;
            }
            const Icon = item.icon;
            return (
              <button
                key={i}
                type="button"
                title={item.label}
                onClick={() => textareaRef.current && item.action(textareaRef.current, onChange)}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
              >
                <Icon size={14} />
              </button>
            );
          })}

          <div className="flex-1" />

          {/* View mode toggle */}
          {showPreview && (
            <div className="flex bg-zinc-800 rounded-md p-0.5">
              {(["edit", "preview", "split"] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setViewMode(m)}
                  className={cn(
                    "px-2 py-0.5 text-[10px] capitalize rounded-sm transition-colors",
                    viewMode === m ? "bg-zinc-700 text-zinc-200" : "text-zinc-500 hover:text-zinc-400",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      {viewMode === "edit" && editorArea}
      {viewMode === "preview" && previewArea}
      {viewMode === "split" && (
        <div className="grid grid-cols-2 divide-x divide-zinc-800">
          <div>{editorArea}</div>
          <div>{previewArea}</div>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-3 text-[10px] text-zinc-600">
          <span>Markdown</span>
          <span>{value.length} chars</span>
        </div>
      </div>
    </div>
  );
}
