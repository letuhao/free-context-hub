export type Lesson = {
  lesson_id: string;
  project_id: string;
  lesson_type: string;
  title: string;
  content: string;
  tags: string[];
  source_refs: string[];
  created_at: string;
  updated_at: string;
  captured_by: string | null;
  summary: string | null;
  status: string;
  superseded_by: string | null;
};

export const LESSON_TYPES = ["decision", "workaround", "preference", "guardrail", "general_note"] as const;
export const LESSON_STATUSES = ["active", "draft", "superseded", "archived"] as const;
