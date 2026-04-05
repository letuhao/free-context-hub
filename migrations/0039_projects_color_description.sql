-- Add color and description columns to projects table for multi-project UX
ALTER TABLE projects ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;
