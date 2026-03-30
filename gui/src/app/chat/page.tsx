"use client";

import { useRef, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport, isTextUIPart, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { useProject } from "@/contexts/project-context";
import { cn } from "@/lib/cn";

const API_URL = process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "http://localhost:3001";
const API_TOKEN = process.env.NEXT_PUBLIC_CONTEXTHUB_TOKEN;

const SUGGESTED_PROMPTS = [
  "What are our key architectural decisions?",
  "Show recent workarounds",
  "Can I deploy to production?",
  "Summarize project conventions",
];

export default function ChatPage() {
  const { projectId } = useProject();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState("");

  const { messages, sendMessage, status, stop } = useChat({
    transport: new TextStreamChatTransport({
      api: `${API_URL}/api/chat`,
      headers: {
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
      },
      body: {
        project_id: projectId,
      },
    }),
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;
    sendMessage({ text });
    setInputValue("");
  };

  const handlePromptClick = (prompt: string) => {
    sendMessage({ text: prompt });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
        <h1 className="text-lg font-semibold text-zinc-100">Chat</h1>
        <p className="text-xs text-zinc-500">Ask questions about {projectId} — AI searches your knowledge base</p>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center">
            <div className="text-4xl mb-4 opacity-30">💬</div>
            <h2 className="text-base font-semibold text-zinc-300 mb-2">Ask me anything</h2>
            <p className="text-sm text-zinc-500 mb-6">
              I can search lessons, check guardrails, and find code in your project.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handlePromptClick(prompt)}
                  className="px-3 py-1.5 rounded-full border border-zinc-700 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}

            {/* Streaming indicator */}
            {isStreaming && messages.length > 0 && messages[messages.length - 1].role === "user" && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm shrink-0">
                  AI
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2.5 text-sm text-zinc-500">
                  <span className="animate-pulse">Thinking...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="px-6 py-4 border-t border-zinc-800 shrink-0">
        <div className="max-w-2xl mx-auto flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Ask about this project..."
            disabled={isStreaming}
            className="flex-1 px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-100 outline-none focus:border-zinc-600 disabled:opacity-50 placeholder:text-zinc-600"
            autoFocus
          />
          {isStreaming ? (
            <button
              onClick={() => stop()}
              className="px-4 py-2.5 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="px-4 py-2.5 rounded-lg text-sm font-medium bg-zinc-100 text-zinc-900 hover:bg-zinc-200 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders a single message (user or assistant) with its parts */
function MessageBubble({ message }: { message: UIMessage }) {
  return (
    <div
      className={cn(
        "flex gap-3",
        message.role === "user" ? "justify-end" : "justify-start",
      )}
    >
      {message.role !== "user" && (
        <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-sm shrink-0 mt-0.5">
          AI
        </div>
      )}
      <div
        className={cn(
          "rounded-lg px-4 py-2.5 max-w-[80%] text-sm leading-relaxed",
          message.role === "user"
            ? "bg-zinc-800 text-zinc-200"
            : "bg-zinc-900 border border-zinc-800 text-zinc-300",
        )}
      >
        {/* v6: iterate message.parts — text parts + tool-* parts */}
        {message.parts.map((part, i) => {
          if (isTextUIPart(part)) {
            return (
              <div key={i} className="whitespace-pre-wrap">
                {part.text}
              </div>
            );
          }
          if (isToolUIPart(part)) {
            return <ToolCallDisplay key={i} part={part} />;
          }
          return null;
        })}
      </div>
      {message.role === "user" && (
        <div className="w-7 h-7 rounded-full bg-zinc-700 text-zinc-400 flex items-center justify-center text-sm shrink-0 mt-0.5">
          U
        </div>
      )}
    </div>
  );
}

/** Renders a tool call (search_lessons, check_guardrails, search_code) */
function ToolCallDisplay({ part }: { part: any }) {
  const [expanded, setExpanded] = useState(false);

  const toolName: string = part.toolInvocation?.toolName ?? part.toolName ?? "tool";
  const args = part.toolInvocation?.args ?? part.args ?? {};
  const result = part.toolInvocation?.result ?? part.result;
  const state: string = part.toolInvocation?.state ?? part.state ?? "call";

  const toolLabels: Record<string, string> = {
    search_lessons: "Searching lessons",
    check_guardrails: "Checking guardrails",
    search_code: "Searching code",
  };

  const label = toolLabels[toolName] ?? toolName;
  const argSummary = args.query ?? args.action ?? JSON.stringify(args);

  return (
    <div className="my-2 border border-zinc-800 rounded-md bg-zinc-950 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-900 transition-colors"
      >
        <span className="text-blue-400">🔧</span>
        <span className="text-zinc-400 flex-1">
          {label}: <span className="text-zinc-500">&ldquo;{String(argSummary).slice(0, 60)}&rdquo;</span>
        </span>
        {state === "call" && <span className="text-zinc-600 animate-pulse">running...</span>}
        {(state === "result" || state === "partial-call") && <span className="text-emerald-500">done</span>}
        <span className="text-zinc-600">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && result && (
        <div className="px-3 py-2 border-t border-zinc-800 max-h-[200px] overflow-y-auto">
          <pre className="text-[11px] text-zinc-500 whitespace-pre-wrap">
            {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
