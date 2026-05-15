-- 0052: Unify the lesson-type systems (Phase 13 bug-fix SS2 — BUG-13.5-1).
--
-- lesson_types (Phase 8) becomes the single type-definition registry;
-- taxonomy_profiles (Phase 13) reference registry type_keys instead of holding
-- inline {type,label,description,color} definitions.
--
-- Idempotent + data-preserving: ADD COLUMN IF NOT EXISTS, INSERT ON CONFLICT,
-- UPDATE. No DELETE — lessons.lesson_type strings are never touched (F3-AC7).

-- (1) lesson_types.scope — 'global' types are always valid (the 5 builtins +
--     Phase 8 custom types); 'profile' types are valid for a project only while
--     an active taxonomy profile references them.
ALTER TABLE lesson_types
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global'
  CHECK (scope IN ('global', 'profile'));

-- (2) Convert each taxonomy_profiles row from inline type-objects to a JSONB
--     string-array of type_key refs, registering each type in lesson_types
--     (scope='profile') on the way. Re-runnable: a profile whose lesson_types
--     elements are already strings is skipped.
DO $$
DECLARE
  prof RECORD;
  elem JSONB;
  keys TEXT[];
BEGIN
  FOR prof IN SELECT profile_id, lesson_types, is_builtin FROM taxonomy_profiles LOOP
    IF jsonb_typeof(prof.lesson_types) <> 'array'
       OR jsonb_array_length(prof.lesson_types) = 0
       OR jsonb_typeof(prof.lesson_types -> 0) <> 'object' THEN
      CONTINUE;  -- non-array / empty / already-converted
    END IF;

    keys := ARRAY[]::TEXT[];
    FOR elem IN SELECT * FROM jsonb_array_elements(prof.lesson_types) LOOP
      INSERT INTO lesson_types (type_key, display_name, description, color, is_builtin, scope)
      VALUES (
        elem ->> 'type',
        COALESCE(elem ->> 'label', elem ->> 'type'),
        elem ->> 'description',
        COALESCE(elem ->> 'color', 'zinc'),
        prof.is_builtin,
        'profile'
      )
      ON CONFLICT (type_key) DO NOTHING;  -- never clobber an existing global type
      keys := keys || (elem ->> 'type');
    END LOOP;

    UPDATE taxonomy_profiles
    SET lesson_types = to_jsonb(keys), updated_at = now()
    WHERE profile_id = prof.profile_id;
  END LOOP;
END $$;
