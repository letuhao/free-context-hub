"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

function CodeBlock({ className, children, ...props }: any) {
  const match = /language-(\w+)/.exec(className || "");
  const lang = match ? match[1] : "";
  const code = String(children).replace(/\n$/, "");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!className) {
    // Inline code
    return (
      <code className="bg-zinc-800 px-1 py-0.5 rounded text-[13px] font-mono text-emerald-400" {...props}>
        {children}
      </code>
    );
  }

  // Code block
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden my-2">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/60">
        <span className="text-[11px] text-zinc-500 font-mono">{lang || "text"}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="px-4 py-3 text-[13px] font-mono leading-relaxed overflow-x-auto">
        <code className={className} {...props}>{children}</code>
      </pre>
    </div>
  );
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: CodeBlock,
        h1: ({ children }) => <h1 className="text-base font-semibold text-zinc-100 pb-1 border-b border-zinc-800 mb-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-semibold text-zinc-100 pb-1 border-b border-zinc-800 mb-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-zinc-200 mb-1">{children}</h3>,
        p: ({ children }) => <p className="text-sm text-zinc-300 leading-relaxed mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="text-sm text-zinc-400 space-y-1 list-disc list-inside mb-2">{children}</ul>,
        ol: ({ children }) => <ol className="text-sm text-zinc-400 space-y-1 list-decimal list-inside mb-2">{children}</ol>,
        li: ({ children }) => <li><span className="text-zinc-400">{children}</span></li>,
        strong: ({ children }) => <strong className="text-zinc-200">{children}</strong>,
        a: ({ href, children }) => <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">{children}</a>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-zinc-700 pl-3 text-sm text-zinc-500 italic my-2">{children}</blockquote>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
