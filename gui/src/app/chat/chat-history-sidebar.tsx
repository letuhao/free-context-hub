"use client";

import { useState, useEffect, useCallback } from "react";
import { useProject } from "@/contexts/project-context";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { Plus, Search, PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import { relTime } from "@/lib/rel-time";

type Conversation = {
  conversation_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
};

interface ChatHistorySidebarProps {
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  refreshKey: number;
}

export function ChatHistorySidebar({ activeId, onSelect, onNewChat, refreshKey }: ChatHistorySidebarProps) {
  const { projectId } = useProject();
  const { toast } = useToast();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.listConversations({ project_id: projectId });
      setConversations(res.conversations ?? []);
    } catch (err) {
      setConversations([]);
      toast("error", "Failed to load conversations");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchConversations(); }, [fetchConversations, refreshKey]);

  const filtered = search
    ? conversations.filter((c) => c.title.toLowerCase().includes(search.toLowerCase()))
    : conversations;

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await api.deleteConversation(id, { project_id: projectId });
      fetchConversations();
      if (activeId === id) onNewChat();
    } catch {
      toast("error", "Failed to delete conversation");
    }
  };

  if (collapsed) {
    return (
      <div className="w-10 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col items-center py-3 gap-2">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="Expand"
        >
          <PanelLeftOpen size={16} />
        </button>
        <button
          onClick={onNewChat}
          className="p-1.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="New Chat"
        >
          <Plus size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 shrink-0 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-300">Conversations</span>
        <button
          onClick={onNewChat}
          className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          title="New Chat"
        >
          <Plus size={18} strokeWidth={1.5} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-800/60">
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-md px-2.5 py-1.5">
          <Search size={14} strokeWidth={1.5} className="text-zinc-600 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="bg-transparent text-xs text-zinc-400 placeholder-zinc-600 outline-none w-full"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="px-4 py-6 text-xs text-zinc-600 text-center">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-6 text-xs text-zinc-600 text-center">
            {search ? "No matches" : "No conversations yet"}
          </div>
        ) : (
          filtered.map((conv) => {
            const isActive = conv.conversation_id === activeId;
            return (
              <div
                key={conv.conversation_id}
                onClick={() => onSelect(conv.conversation_id)}
                className={`flex flex-col gap-0.5 px-4 py-2.5 cursor-pointer group transition-colors ${
                  isActive
                    ? "bg-zinc-800 border-l-2 border-l-blue-500"
                    : "hover:bg-zinc-800/40 border-l-2 border-l-transparent"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs truncate ${isActive ? "text-zinc-200 font-medium" : "text-zinc-400"}`}>
                    {conv.title || "Untitled"}
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, conv.conversation_id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-zinc-700 text-zinc-600 hover:text-red-400 transition-all"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <span className="text-[10px] text-zinc-600">{relTime(conv.updated_at || conv.created_at)}</span>
              </div>
            );
          })
        )}
      </div>

      {/* Collapse */}
      <div className="px-3 py-2 border-t border-zinc-800">
        <button
          onClick={() => setCollapsed(true)}
          className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors w-full justify-center"
        >
          <PanelLeftClose size={14} />
          Collapse
        </button>
      </div>
    </div>
  );
}
