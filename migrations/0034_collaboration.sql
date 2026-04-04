-- 0034: Collaboration features — comments, feedback, bookmarks

-- Threaded comments on lessons
CREATE TABLE IF NOT EXISTS lesson_comments (
  comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  parent_id UUID REFERENCES lesson_comments(comment_id) ON DELETE CASCADE,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lesson_comments_lesson ON lesson_comments(lesson_id, created_at ASC);

-- Feedback (thumbs up/down) on lessons — one vote per user per lesson
CREATE TABLE IF NOT EXISTS lesson_feedback (
  lesson_id UUID NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote SMALLINT NOT NULL CHECK (vote IN (1, -1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lesson_id, user_id)
);

-- Bookmarks — one per user per lesson
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id TEXT NOT NULL,
  lesson_id UUID NOT NULL REFERENCES lessons(lesson_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at DESC);
