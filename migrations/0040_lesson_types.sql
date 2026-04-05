-- 0040: Custom lesson types table + seed built-in types + relax CHECK constraint

CREATE TABLE IF NOT EXISTS lesson_types (
  type_key     TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description  TEXT,
  color        TEXT NOT NULL DEFAULT 'zinc',
  template     TEXT,
  is_builtin   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the 5 built-in types
INSERT INTO lesson_types (type_key, display_name, description, color, is_builtin) VALUES
  ('decision',     'Decision',     'Architectural choices, design decisions, trade-offs made',            'blue',   true),
  ('preference',   'Preference',   'Team conventions, coding standards, style preferences',              'purple', true),
  ('guardrail',    'Guardrail',    'Safety rules enforced before agent actions',                          'red',    true),
  ('workaround',   'Workaround',   'Bug fixes, temporary solutions, known issues with workarounds',      'amber',  true),
  ('general_note', 'General Note', 'General knowledge, context, reference information',                  'zinc',   true)
ON CONFLICT (type_key) DO NOTHING;

-- Drop the CHECK constraint on lessons.lesson_type to allow custom types
-- The constraint name may vary; use ALTER TABLE to drop all checks on lesson_type
DO $$
BEGIN
  -- Find and drop the check constraint that references lesson_type
  PERFORM 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'lessons' AND column_name = 'lesson_type';
  IF FOUND THEN
    EXECUTE (
      SELECT 'ALTER TABLE lessons DROP CONSTRAINT ' || constraint_name
      FROM information_schema.constraint_column_usage
      WHERE table_name = 'lessons' AND column_name = 'lesson_type'
      LIMIT 1
    );
  END IF;
END $$;
