-- Force re-index on next index_project call by clearing content_hash.
-- This makes the incremental guard re-process every file, which will:
-- 1. Use smartChunker for language-aware chunking
-- 2. Populate fts with camelCase/snake_case expanded tokens via expandForFtsIndex()
-- 3. Populate language, symbol_name, symbol_type, is_test metadata
UPDATE files SET content_hash = 'force-reindex-fts';
