# Diseño: Agente RAG de Procedimientos de Empresa

**Fecha:** 2026-09-13
**Estado:** Propuesto (pendiente revisión)

## 1. Objetivo

Convertir la app actual (agente de reserva de turnos) en un **agente conversacional RAG** que responde consultas de empleados sobre los procedimientos internos de la empresa (políticas de seguridad, normativas, instructivos, etc.), respondiendo **únicamente** en base a documentos indexados y citando la fuente. Pensado como base de una futura funcionalidad dentro de un SaaS multi-empresa.

## 2. Contexto y decisiones tomadas

- **Fuente de documentos:** PDF y Word (confirmado con documentos reales ya provistos en `documentos/`: políticas de seguridad HSS, normativa de gestión de seguridad y salud ocupacional, rol de evacuación, procedimiento de incidentes).
- **Funcionalidad de turnos:** se elimina por completo (código, tools, tabla, scripts).
- **Ingesta de documentos:** script CLI (no panel admin en esta versión).
- **Multi-tenant:** se prepara el esquema de datos con `empresa_id` desde ahora, aunque no hay auth todavía.
- **Identificación de empresa (sin auth):** variable de entorno `EMPRESA_ID` fija.
- **Modo de respuesta:** streaming (`streamText` + `useChat`).
- **Citas de fuente:** obligatorias — el agente menciona el documento del que sacó la información.

## 3. Arquitectura elegida

**Supabase (pgvector) + OpenAI embeddings + Vercel AI SDK**, reutilizando toda la infraestructura ya presente en el proyecto (Supabase pago, API key de OpenAI). Se descartan una vector DB externa (Pinecone/Weaviate — sobre-ingeniería para este volumen) y similitud en memoria sin DB (no escala, no aprovecha Postgres).

## 4. Modelo de datos

Extensión `pgvector` habilitada en el proyecto de Supabase.

```sql
create extension if not exists vector;

create table documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id text not null,
  nombre text not null,
  tipo text not null check (tipo in ('pdf', 'docx')),
  created_at timestamptz not null default now()
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references documentos(id) on delete cascade,
  empresa_id text not null,
  contenido text not null,
  embedding vector(1536) not null,
  metadata jsonb not null default '{}'::jsonb, -- { chunk_index, pagina? }
  created_at timestamptz not null default now()
);

create index on chunks using hnsw (embedding vector_cosine_ops);
create index on chunks (empresa_id);
```

**Función RPC `match_chunks`:**

```sql
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
```

## 5. Pipeline de ingesta

**Script:** `scripts/ingest-docs.ts`, ejecutable con `pnpm ingest [ruta-opcional]`.

- Sin argumento: procesa todos los archivos de `documentos/` (carpeta en `.gitignore`).
- Con argumento: procesa un único archivo.

**Flujo por archivo:**
1. Detectar tipo por extensión (`.pdf` → `pdf-parse`, `.docx` → `mammoth`) y extraer texto plano.
2. Trocear el texto con `src/lib/chunking.ts`: agrupar por párrafos hasta ~1500 caracteres por chunk, con ~200 caracteres de solapamiento entre chunks consecutivos.
3. **Idempotencia:** si ya existe un `documento` con el mismo `nombre` + `empresa_id`, borrar su fila (cascada borra sus chunks) antes de insertar la versión nueva.
4. Insertar fila en `documentos`.
5. Generar embeddings en batches de ~100 chunks con `embedMany` (`openai.embedding("text-embedding-3-small")`).
6. Insertar chunks (`contenido`, `embedding`, `metadata`) asociados al `documento_id`.

**Manejo de errores:** error en un archivo no aborta el batch; se loggea y se continúa. Resumen final: documentos procesados, fallidos, chunks totales generados. Logging con el estilo educativo existente (emojis, progreso por archivo).

**Nuevas dependencias:** `pdf-parse`, `mammoth`.

**Permisos:** el script usa la **service role key** de Supabase (server-side, nunca expuesta al cliente) para poder escribir sin restricciones de RLS.

## 6. Tool de retrieval

**`buscarProcedimientos`** (única tool del agente, en `src/lib/rag.ts`):

```
input:  { consulta: string }
output: [{ contenido, documento, similitud }]  // array vacío si no hay match relevante
```

Ejecución: embeber `consulta` → `supabase.rpc("match_chunks", { query_embedding, p_empresa_id: EMPRESA_ID, match_count: 5 })`. Envuelto en try/catch; ante fallo devuelve un resultado que permite al modelo informar el problema sin romper el stream.

## 7. Prompt del agente y endpoint

**Reglas del prompt** (reemplaza integralmente el prompt de turnos):
- Uso obligatorio de `buscarProcedimientos` antes de responder cualquier consulta sobre procedimientos — nunca responder de memoria.
- Si no hay resultados relevantes, decirlo explícitamente en vez de inventar.
- Citar siempre el nombre del documento fuente.
- Rechazar amablemente consultas fuera del dominio de procedimientos de la empresa.
- `maxSteps: 5` (ciclo RAG típico: 1 tool call + respuesta).

**Endpoint `src/app/api/chat/route.ts`:**
- `generateText` → `streamText`, con la tool `buscarProcedimientos` y el nuevo `system`.
- Retorna `result.toDataStreamResponse()`.
- Valida `EMPRESA_ID` al arrancar (mismo patrón que `db.ts` con `SUPABASE_URL`/`SUPABASE_KEY`).

## 8. Frontend

`src/app/page.tsx` migra de fetch manual a **`useChat`** (`ai/react`):
- `useChat({ api: "/api/chat" })` maneja mensajes, input, envío y streaming.
- Reutiliza `page.module.css`; se actualizan textos (título, placeholder) al nuevo dominio.
- Indicador "Buscando en procedimientos..." mientras `isLoading`.
- Errores de stream mostrados inline.

## 9. Limpieza de código de turnos

**Eliminar:**
- `src/lib/turnos.ts`, `src/lib/tools.ts`, `src/lib/validaciones.ts`
- `scripts/setup-db.sql`, `scripts/setup-db.ts`
- Dependencias `nodemailer`/`resend` en `package.json` si no quedan usos fuera de turnos (a confirmar durante implementación).

**Agregar:**
- `src/lib/rag.ts`, `src/lib/chunking.ts`
- `scripts/ingest-docs.ts`, `scripts/setup-schema.sql`
- Script `ingest` en `package.json` (reemplaza `setup-db`)
- `.env.local.example` actualizado (agrega `EMPRESA_ID`)
- `README.md` actualizado al nuevo propósito
- `.gitignore`: agregar `documentos/`

## 10. Seguridad de acceso a datos

Sin auth todavía, no se activa RLS por usuario. El script de ingesta (escritura) usa service role key server-side; el endpoint de chat (solo lectura vía RPC) puede usar la anon key ya que el filtro por `empresa_id` ocurre dentro de `match_chunks`. Cuando se agregue auth real para el SaaS, se activa RLS atada al tenant del usuario — el esquema con `empresa_id` ya lo deja preparado.

## 11. Plan de validación

No hay test runner en el proyecto. Validación manual:
1. Ingestar los 4 PDFs ya presentes en `documentos/` y verificar filas en `documentos`/`chunks` con embeddings no nulos.
2. Probar `match_chunks` en el SQL Editor de Supabase con un embedding de ejemplo.
3. `pnpm dev` y probar: pregunta cubierta por los docs (responde y cita fuente), pregunta fuera de dominio (la rechaza), pregunta no documentada (dice que no tiene esa info).
4. Verificar streaming visual y estado de carga.
5. Re-ingestar un documento modificado y confirmar reemplazo sin duplicados.

## 12. Fuera de alcance (futuro)

- Autenticación y tabla `empresas` real (multi-tenant completo).
- Panel admin de carga de documentos.
- Tests automatizados (sugerido: unit tests de `chunking.ts` con vitest).
- Vector DB externa si el volumen lo justifica.
