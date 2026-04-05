"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { Breadcrumb, PageHeader, Button, EmptyState, Badge } from "@/components/ui";
import { StatCardSkeleton } from "@/components/ui/loading-skeleton";
import { useToast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Group = {
  group_id: string;
  name: string;
  description: string | null;
  member_count: number;
};

export default function GroupsPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [groups, setGroups] = useState<Group[]>([]);
  const [initialLoad, setInitialLoad] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupId, setNewGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [creating, setCreating] = useState(false);

  // Members panel
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [newMemberId, setNewMemberId] = useState("");
  const [addingMember, setAddingMember] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchGroups = useCallback(async () => {
    try {
      const res = await api.listGroups();
      setGroups(res.groups ?? []);
    } catch {
      toastRef.current("error", "Failed to load groups");
    } finally {
      setInitialLoad(false);
    }
  }, []);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const fetchMembers = useCallback(async (groupId: string) => {
    setLoadingMembers(true);
    try {
      const res = await api.listGroupMembers(groupId);
      setMembers(res.members ?? []);
    } catch {
      toastRef.current("error", "Failed to load members");
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const handleExpand = (groupId: string) => {
    if (expandedGroup === groupId) {
      setExpandedGroup(null);
      setMembers([]);
    } else {
      setExpandedGroup(groupId);
      fetchMembers(groupId);
    }
  };

  const handleCreate = async () => {
    if (!newGroupId.trim() || !newGroupName.trim()) return;
    setCreating(true);
    try {
      await api.createGroup({
        group_id: newGroupId.trim(),
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || undefined,
      });
      toastRef.current("success", `Group "${newGroupId}" created`);
      setCreateOpen(false);
      setNewGroupId("");
      setNewGroupName("");
      setNewGroupDesc("");
      fetchGroups();
    } catch (err) {
      toastRef.current("error", `Create failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteGroup(deleteTarget);
      toastRef.current("success", `Group "${deleteTarget}" deleted`);
      setDeleteTarget(null);
      if (expandedGroup === deleteTarget) {
        setExpandedGroup(null);
        setMembers([]);
      }
      fetchGroups();
    } catch (err) {
      toastRef.current("error", `Delete failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleAddMember = async () => {
    if (!expandedGroup || !newMemberId.trim()) return;
    setAddingMember(true);
    try {
      await api.addProjectToGroup(expandedGroup, newMemberId.trim());
      toastRef.current("success", `Added "${newMemberId}" to group`);
      setNewMemberId("");
      fetchMembers(expandedGroup);
      fetchGroups(); // refresh member count
    } catch (err) {
      toastRef.current("error", `Add failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (projectId: string) => {
    if (!expandedGroup) return;
    try {
      await api.removeProjectFromGroup(expandedGroup, projectId);
      toastRef.current("success", `Removed "${projectId}" from group`);
      fetchMembers(expandedGroup);
      fetchGroups();
    } catch (err) {
      toastRef.current("error", `Remove failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  return (
    <div className="p-6">
      <Breadcrumb items={[{ label: "Project", href: "/projects" }, { label: "Groups" }]} />
      <PageHeader
        title="Project Groups"
        subtitle="Manage shared knowledge groups across projects"
        actions={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            Create Group
          </Button>
        }
      />

      {/* Create Group Dialog */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-zinc-100 mb-4">Create Group</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Group ID</label>
                <input
                  type="text"
                  value={newGroupId}
                  onChange={(e) => setNewGroupId(e.target.value)}
                  placeholder="e.g. order-payment-team"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-600"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Name</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="e.g. Order-Payment Team"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-600"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-400 mb-1 block">Description (optional)</label>
                <input
                  type="text"
                  value={newGroupDesc}
                  onChange={(e) => setNewGroupDesc(e.target.value)}
                  placeholder="Shared API contracts and retry policies"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md text-sm text-zinc-200 outline-none focus:border-zinc-600"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button size="sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={creating || !newGroupId.trim() || !newGroupName.trim()}
              >
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Groups List */}
      {initialLoad ? (
        <StatCardSkeleton count={3} />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          description="Create a group to share knowledge across multiple projects. Projects in the same group can search each other's lessons."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              Create Your First Group
            </Button>
          }
        />
      ) : (
        <div className="space-y-3 mt-6">
          {groups.map((g) => (
            <div
              key={g.group_id}
              className="border border-zinc-800 rounded-lg bg-zinc-900/50"
            >
              {/* Group header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-zinc-900 transition-colors rounded-t-lg"
                onClick={() => handleExpand(g.group_id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-zinc-600 text-xs">
                    {expandedGroup === g.group_id ? "\u25BC" : "\u25B6"}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-200">{g.name}</span>
                      <Badge value={g.group_id} />
                    </div>
                    {g.description && (
                      <p className="text-xs text-zinc-500 mt-0.5">{g.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500">
                    {g.member_count} {g.member_count === 1 ? "member" : "members"}
                  </span>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      setDeleteTarget(g.group_id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {/* Expanded: members panel */}
              {expandedGroup === g.group_id && (
                <div className="border-t border-zinc-800 px-4 py-3">
                  {loadingMembers ? (
                    <p className="text-xs text-zinc-500">Loading members...</p>
                  ) : (
                    <>
                      {members.length === 0 ? (
                        <p className="text-xs text-zinc-500">No members yet. Add a project below.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2 mb-3">
                          {members.map((m) => (
                            <div
                              key={m}
                              className="flex items-center gap-1.5 bg-zinc-800 rounded-md px-2.5 py-1"
                            >
                              <span className="text-xs text-zinc-300">{m}</span>
                              <button
                                onClick={() => handleRemoveMember(m)}
                                className="text-zinc-600 hover:text-red-400 text-xs ml-1"
                                title={`Remove ${m}`}
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Add member input */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newMemberId}
                          onChange={(e) => setNewMemberId(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddMember(); }}
                          placeholder="Project ID to add..."
                          className="flex-1 px-2.5 py-1.5 bg-zinc-800 border border-zinc-700 rounded-md text-xs text-zinc-300 outline-none focus:border-zinc-600"
                        />
                        <Button
                          size="sm"
                          onClick={handleAddMember}
                          disabled={addingMember || !newMemberId.trim()}
                        >
                          {addingMember ? "Adding..." : "Add"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Group"
        description={`This will delete the group "${deleteTarget}". Members will be unlinked. Shared lessons stored in the group project will remain.`}
        confirmText="Delete"
        confirmValue={deleteTarget ?? ""}
        destructive
      />
    </div>
  );
}
