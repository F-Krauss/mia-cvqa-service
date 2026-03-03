-- pgvector is required for raw SQL casts to ::vector / public.vector in VectorStoreService.
-- Provision the extension at migration time so runtime queries don't fail or stall.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;
