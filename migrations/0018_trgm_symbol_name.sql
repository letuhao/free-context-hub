-- Enable pg_trgm extension for fast ILIKE queries on symbol_name.
-- This index accelerates tier 2 (symbol lookup) in search_code_tiered,
-- which uses `symbol_name ILIKE ANY(...)` with leading wildcards.
-- Without this index, ILIKE ANY with leading % is a full table scan.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_chunks_symbol_name_trgm
  ON chunks USING gin (symbol_name gin_trgm_ops)
  WHERE symbol_name IS NOT NULL;
