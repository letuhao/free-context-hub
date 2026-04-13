"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useChat } from "@ai-sdk/react";
import { TextStreamChatTransport, isTextUIPart, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { useProject } from "@/contexts/project-context";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Send, Square, Copy, Check, Bookmark, Pencil, RotateCcw, Sparkles, Pin, ChevronUp, ChevronDown, Bot, MessageSquare, Search, Code2, Shield, Wrench, Paperclip } from "lucide-react";
import { MarkdownContent } from "./markdown-content";
import { ChatHistorySidebar } from "./chat-history-sidebar";
import { NoProjectGuard } from "@/components/no-project-guard";
import { ProjectBadge } from "@/components/project-badge";
import { CreateLessonPopover } from "./create-lesson-popover";

type HistoricalMessage = { id: string; role: "user" | "assistant"; content: string };

const API_URL = process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "http://localhost:3001";
const API_TOKEN = process.env.NEXT_PUBLIC_CONTEXTHUB_TOKEN;

const SUGGESTED_PROMPTS = [
  "What are our key architectural decisions?",
  "Show recent workarounds",
  "Can I deploy to production?",
  "Summarize project conventions",
];

// ── Pinned Messages Bar ──
function PinnedMessagesBar({ messages }: { messages: { id: string; text: string }[] }) {
  const [expanded, setExpanded] = useState(true);

  if (messages.length === 0) return null;

  return (
    <div className="px-6 py-2 border-b border-zinc-800 bg-zinc-900/40 shrink-0">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs text-zinc-400 font-medium flex items-center gap-1.5">
          <Pin size={14} strokeWidth={1.5} className="text-zinc-500" />
          {messages.length} pinned message{messages.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-0.5 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>
      {expanded && (
        <div className="space-y-1.5">
          {messages.map((m) => (
            <div key={m.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-zinc-800/50 border border-zinc-800 rounded-md">
              <span className="text-[11px] text-zinc-400 flex-1 truncate">{m.text}</span>
              <button className="text-[10px] text-blue-400 hover:text-blue-300 shrink-0 transition-colors">
                Jump
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Message Hover Toolbar ──
function MessageToolbar({ role, onCopy, onPin, onCreateLesson }: {
  role: string;
  onCopy: () => void;
  onPin?: () => void;
  onCreateLesson?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-0.5 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button onClick={handleCopy} className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors" title="Copy">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {role === "assistant" && onPin && (
        <button onClick={onPin} className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors" title="Pin">
          <Bookmark size={14} strokeWidth={1.5} />
        </button>
      )}
      {role === "assistant" && onCreateLesson && (
        <button
          onClick={onCreateLesson}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] bg-blue-600/20 text-blue-400 border border-blue-700/50 hover:bg-blue-600/30 transition-colors ml-1"
        >
          <Sparkles size={10} />
          Create Lesson
        </button>
      )}
      {role === "user" && (
        <>
          <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors" title="Edit">
            <Pencil size={14} />
          </button>
          <button className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors" title="Retry">
            <RotateCcw size={14} />
          </button>
        </>
      )}
    </div>
  );
}

// ── Tool Call Display (restyled) ──
function ToolCallDisplay({ part }: { part: any }) {
  const [expanded, setExpanded] = useState(false);
  const toolName: string = part.toolInvocation?.toolName ?? part.toolName ?? "tool";
  const args = part.toolInvocation?.args ?? part.args ?? {};
  const result = part.toolInvocation?.result ?? part.result;
  const state: string = part.toolInvocation?.state ?? part.state ?? "call";

  const toolIcons: Record<string, React.ReactNode> = {
    search_lessons: <Search size={14} className="text-blue-400" />,
    search_code: <Code2 size={14} className="text-emerald-400" />,
    search_documents: <Search size={14} className="text-purple-400" />,
    check_guardrails: <Shield size={14} className="text-red-400" />,
  };

  // Specialized rendering for search_documents — show chunks with doc name + page + snippet
  const isDocChunks =
    toolName === "search_documents" &&
    result &&
    typeof result === "object" &&
    Array.isArray((result as any).matches);

  return (
    <div className="my-2 bg-zinc-900/60 border border-zinc-800 rounded-lg overflow-hidden border-l-2 border-l-blue-500">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-2.5 flex items-center gap-2.5 text-left hover:bg-zinc-800/30 transition-colors"
      >
        <span className="shrink-0">{toolIcons[toolName] ?? <Wrench size={14} className="text-zinc-400" />}</span>
        <span className="text-xs font-mono text-zinc-300">{toolName}</span>
        <span className="ml-auto">
          {state === "call" ? (
            <span className="text-zinc-600 text-[10px] animate-pulse">running...</span>
          ) : (
            <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">done</span>
          )}
        </span>
      </button>
      {expanded && result && (
        <div className="px-3 py-2 border-t border-zinc-800/60 max-h-[260px] overflow-y-auto">
          {isDocChunks ? (
            <div className="space-y-2">
              {((result as any).matches as any[]).length === 0 ? (
                <p className="text-[11px] text-zinc-600">no matching chunks</p>
              ) : (
                ((result as any).matches as any[]).map((m: any, i: number) => (
                  <a
                    key={i}
                    href={`/documents#doc-${m.doc_id}`}
                    className="block p-2 bg-zinc-950/40 border border-zinc-800 rounded hover:border-zinc-700 hover:bg-zinc-900/60 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-medium text-zinc-200 truncate">{m.doc_name}</span>
                      {m.page !== null && m.page !== undefined && (
                        <span className="text-[9px] text-zinc-600">p{m.page}</span>
                      )}
                      {m.chunk_type && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-400">
                          {m.chunk_type}
                        </span>
                      )}
                      <span className="ml-auto text-[9px] font-mono text-purple-400">
                        {m.score !== undefined ? `${Math.round(m.score * 100)}%` : ""}
                      </span>
                    </div>
                    {m.heading && (
                      <p className="text-[10px] text-zinc-500 mb-0.5 truncate">§ {m.heading}</p>
                    )}
                    <p className="text-[11px] text-zinc-400 line-clamp-2">{m.snippet}</p>
                  </a>
                ))
              )}
            </div>
          ) : (
            <pre className="text-[11px] text-zinc-500 whitespace-pre-wrap font-mono">
              {typeof result === "string" ? result : JSON.stringify(result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Message Bubble ──
function MessageBubble({ message, onCreateLesson, onPin }: {
  message: UIMessage;
  onCreateLesson: (content: string) => void;
  onPin: (text: string) => void;
}) {
  const [showCreateLesson, setShowCreateLesson] = useState(false);
  const isUser = message.role === "user";

  // Extract full text for copy/lesson creation
  const fullText = message.parts
    .filter(isTextUIPart)
    .map((p) => p.text)
    .join("\n");

  const handleCopy = () => {
    navigator.clipboard.writeText(fullText);
  };

  return (
    <div className={cn("flex gap-3 group", isUser ? "justify-end" : "justify-start")}>
      {/* User hover toolbar (left side) */}
      {isUser && (
        <MessageToolbar role="user" onCopy={handleCopy} />
      )}

      {/* AI avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
          <Bot size={14} className="text-zinc-400" />
        </div>
      )}

      <div className={cn("max-w-[75%]", isUser ? "" : "")}>
        <div className={cn(
          "px-4 py-2.5",
          isUser
            ? "bg-blue-600 rounded-2xl rounded-tr-sm text-sm text-white"
            : "bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-sm"
        )}>
          {message.parts.map((part, i) => {
            if (isTextUIPart(part)) {
              return isUser ? (
                <div key={i}>{part.text}</div>
              ) : (
                <div key={i}><MarkdownContent content={part.text} /></div>
              );
            }
            if (isToolUIPart(part)) {
              return <ToolCallDisplay key={i} part={part} />;
            }
            return null;
          })}
        </div>

        {/* AI hover toolbar (below bubble) */}
        {!isUser && (
          <div className="relative">
            <MessageToolbar
              role="assistant"
              onCopy={handleCopy}
              onPin={() => onPin(fullText.slice(0, 100))}
              onCreateLesson={() => setShowCreateLesson(true)}
            />
            {showCreateLesson && (
              <CreateLessonPopover
                content={fullText}
                onClose={() => setShowCreateLesson(false)}
                onCreated={() => setShowCreateLesson(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ──
export default function ChatPage() {
  const { projectId } = useProject();
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState("");
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [pinnedMessages, setPinnedMessages] = useState<{ id: string; text: string }[]>([]);
  const [historicalMessages, setHistoricalMessages] = useState<HistoricalMessage[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);

  const transport = useMemo(
    () => new TextStreamChatTransport({
      api: `${API_URL}/api/chat`,
      headers: {
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
      },
      body: {
        project_id: projectId,
      },
    }),
    [projectId],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: `chat-${chatKey}`,
    transport,
  });

  const isStreaming = status === "streaming" || status === "submitted";

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }
  }, [inputValue]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Persist conversation after assistant replies.
  // useChat + TextStreamChatTransport has stale closure issues — messages captured
  // in callbacks are never the latest. We read the DOM directly to extract text.
  const activeConvIdRef = useRef(activeConvId);
  activeConvIdRef.current = activeConvId;
  const hasPersisted = useRef(false);

  const persistFromDOM = useCallback(async (userText: string) => {
    if (hasPersisted.current) return;
    hasPersisted.current = true;

    // Extract assistant response text from the DOM
    const container = scrollRef.current;
    if (!container) return;

    // Assistant bubbles have the bot avatar + rounded-tl-sm class
    const assistantBubbles = container.querySelectorAll(".rounded-tl-sm");
    const lastBubble = assistantBubbles[assistantBubbles.length - 1];
    const assistantText = lastBubble?.textContent?.trim() ?? "";

    if (!assistantText) return;

    try {
      let convId = activeConvIdRef.current;
      if (!convId) {
        const title = userText.slice(0, 60) || "New conversation";
        const res = await api.createConversation({ project_id: projectId, title });
        convId = res.conversation_id ?? null;
        if (convId) {
          activeConvIdRef.current = convId;
          setActiveConvId(convId);
        }
      }
      if (!convId) return;

      await api.addMessage(convId, { project_id: projectId, role: "user", content: userText });
      await api.addMessage(convId, { project_id: projectId, role: "assistant", content: assistantText });
      setSidebarRefresh((k) => k + 1);
    } catch {
      // Silent — don't interrupt chat UX
      hasPersisted.current = false; // allow retry
    }
  }, [projectId, setActiveConvId, setSidebarRefresh]);

  // MutationObserver to detect when streaming ends (DOM stops changing)
  const pendingUserTextRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const observer = new MutationObserver(() => {
      if (!pendingUserTextRef.current) return;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        const text = pendingUserTextRef.current;
        if (text) {
          pendingUserTextRef.current = null;
          persistFromDOM(text);
        }
      }, 3000);
    });

    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isStreaming) return;
    sendMessage({ text });
    setInputValue("");
    hasPersisted.current = false;
    pendingUserTextRef.current = text;
  };

  const handlePromptClick = (prompt: string) => {
    sendMessage({ text: prompt });
    hasPersisted.current = false;
    pendingUserTextRef.current = prompt;
  };

  const handleNewChat = () => {
    setActiveConvId(null);
    setHistoricalMessages([]);
    setChatKey((k) => k + 1);
    hasPersisted.current = false;
    pendingUserTextRef.current = null;
  };

  const handleSelectConversation = useCallback(async (id: string) => {
    setActiveConvId(id);
    setChatKey((k) => k + 1);
    hasPersisted.current = false;
    pendingUserTextRef.current = null;
    setLoadingConv(true);
    try {
      const res = await api.getConversation(id, { project_id: projectId });
      const msgs: HistoricalMessage[] = (res.messages ?? []).map((m: any, i: number) => ({
        id: m.message_id ?? `hist-${i}`,
        role: m.role === "user" ? "user" as const : "assistant" as const,
        content: m.content ?? "",
      }));
      setHistoricalMessages(msgs);
    } catch {
      toast("error", "Failed to load conversation");
      setHistoricalMessages([]);
    } finally {
      setLoadingConv(false);
    }
  }, [projectId, toast]);

  const handlePinMessage = (text: string) => {
    const id = Date.now().toString();
    setPinnedMessages((prev) => [...prev, { id, text }]);
    toast("success", "Message pinned");
  };

  const handleCreateLesson = (content: string) => {
    // CreateLessonPopover handles this directly
  };

  return (
    <NoProjectGuard>
    <div className="flex flex-1 min-h-0">
      {/* Chat History Sidebar */}
      <ChatHistorySidebar
        activeId={activeConvId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        refreshKey={sidebarRefresh}
      />

      {/* Chat Panel */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-zinc-500 mb-1"><ProjectBadge /></div>
          <h1 className="text-lg font-semibold text-zinc-100">Chat</h1>
          <p className="text-xs text-zinc-500">Ask questions about your project — AI searches your knowledge base</p>
        </div>

        {/* Pinned messages */}
        <PinnedMessagesBar messages={pinnedMessages} />

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
          {loadingConv ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-xs text-zinc-500 animate-pulse">Loading conversation...</p>
            </div>
          ) : messages.length === 0 && historicalMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full max-w-md mx-auto text-center">
              <div className="relative mb-5">
                <div
                  className="w-16 h-16 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center"
                  style={{ boxShadow: "0 0 0 4px rgba(59,130,246,0.08), 0 0 0 8px rgba(59,130,246,0.04)" }}
                >
                  <MessageSquare size={28} strokeWidth={1.5} className="text-zinc-500" />
                </div>
              </div>
              <p className="text-sm text-zinc-400 mb-1 font-medium">Ask anything about your project</p>
              <p className="text-xs text-zinc-600 mb-5">AI searches your knowledge base, lessons, and code</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handlePromptClick(prompt)}
                    className="prompt-pill px-3.5 py-2 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-5">
              {/* Historical messages from loaded conversation */}
              {historicalMessages.map((msg) => (
                <div key={msg.id} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
                  {msg.role === "assistant" && (
                    <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot size={14} className="text-zinc-400" />
                    </div>
                  )}
                  <div className={cn(
                    "max-w-[75%] px-4 py-2.5",
                    msg.role === "user"
                      ? "bg-blue-600/80 rounded-2xl rounded-tr-sm text-sm text-white"
                      : "bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-sm"
                  )}>
                    {msg.role === "user" ? (
                      <div>{msg.content}</div>
                    ) : (
                      <MarkdownContent content={msg.content} />
                    )}
                  </div>
                </div>
              ))}

              {/* Divider between historical and new messages */}
              {historicalMessages.length > 0 && messages.length > 0 && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-zinc-800" />
                  <span className="text-[10px] text-zinc-600">New messages</span>
                  <div className="flex-1 h-px bg-zinc-800" />
                </div>
              )}

              {/* Live streaming messages */}
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onCreateLesson={handleCreateLesson}
                  onPin={handlePinMessage}
                />
              ))}

              {/* Streaming indicator */}
              {isStreaming && messages.length > 0 && messages[messages.length - 1].role === "user" && (
                <div className="flex gap-3">
                  <div className="w-7 h-7 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                    <Bot size={14} className="text-zinc-400" />
                  </div>
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-zinc-500">
                    <span className="inline-flex gap-1">
                      Thinking
                      <span className="inline-flex gap-0.5">
                        <span className="w-1 h-1 rounded-full bg-zinc-500 animate-[dotPulse_1.4s_infinite_0s]" />
                        <span className="w-1 h-1 rounded-full bg-zinc-500 animate-[dotPulse_1.4s_infinite_0.2s]" />
                        <span className="w-1 h-1 rounded-full bg-zinc-500 animate-[dotPulse_1.4s_infinite_0.4s]" />
                      </span>
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input bar */}
        <div className="border-t border-zinc-800 px-6 py-3 shrink-0">
          <div className="max-w-2xl mx-auto flex items-end gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 focus-within:border-zinc-600 transition-colors">
            {/* Attachment button */}
            <button
              className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors shrink-0 mb-0.5"
              title="Attach file"
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
              }}
              placeholder="Ask about your project..."
              disabled={isStreaming}
              className="flex-1 bg-transparent text-sm text-zinc-300 outline-none placeholder-zinc-600 resize-none leading-relaxed py-1 disabled:opacity-50"
              style={{ minHeight: "24px", maxHeight: "120px" }}
              autoFocus
            />
            <div className="flex items-center gap-2 shrink-0 mb-0.5">
              {/* Model selector pill */}
              <button className="px-2.5 py-1 text-[11px] bg-zinc-800 border border-zinc-700 rounded-full text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 transition-colors flex items-center gap-1">
                <Bot size={10} />
                Auto
                <ChevronDown size={10} />
              </button>
              {isStreaming ? (
                <button
                  onClick={() => stop()}
                  className="p-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-red-400 transition-colors"
                  title="Stop"
                >
                  <Square size={16} />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  title="Send (Enter)"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </NoProjectGuard>
  );
}
