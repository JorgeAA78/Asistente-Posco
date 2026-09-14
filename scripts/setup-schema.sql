-- scripts/setup-schema.sql
--
-- INSTRUCCIONES:
-- 1. Ve a tu proyecto en Supabase (https://supabase.com)
-- 2. Abre el SQL Editor
-- 3. Copia y pega este script completo
-- 4. Ejecuta el script haciendo clic en "Run"
--
-- Crea el esquema necesario para el agente RAG de procedimientos:
-- extensión pgvector, tablas de documentos/chunks y la función de búsqueda semántica.

create extension if not exists vector;

create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id text not null,
  nombre text not null,
  tipo text not null check (tipo in ('pdf', 'docx')),
  created_at timestamptz not null default now()
);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos(id) on delete cascade,
  empresa_id text not null,
  contenido text not null,
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chunks_embedding
  on chunks using hnsw (embedding vector_cosine_ops);

create index if not exists idx_chunks_empresa_id
  on chunks (empresa_id);

create or replace function match_chunks(
  query_embedding vector(1536),
  p_empresa_id text,
  match_count int default 5,
  match_threshold float default 0.75
)
returns table (
  contenido text,
  documento text,
  similitud float
)
language sql stable
as $$
  select
    c.contenido,
    d.nombre as documento,
    1 - (c.embedding <=> query_embedding) as similitud
  from chunks c
  join documentos d on d.id = c.documento_id
  where c.empresa_id = p_empresa_id
    and 1 - (c.embedding <=> query_embedding) >= match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

comment on table documentos is 'Documentos de procedimientos indexados por empresa';
comment on table chunks is 'Fragmentos de texto de los documentos, con su embedding para búsqueda semántica';
comment on function match_chunks is 'Devuelve los chunks más similares a un embedding de consulta, filtrados por empresa';
