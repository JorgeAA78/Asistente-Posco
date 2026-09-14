# Agente RAG de Procedimientos - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la app de reserva de turnos en un agente conversacional RAG que responde consultas sobre procedimientos internos de la empresa, citando la fuente, usando Supabase pgvector para la búsqueda semántica.

**Architecture:** Script CLI de ingesta (PDF/Word → chunks → embeddings → Supabase/pgvector) + una tool de retrieval (`buscarProcedimientos`) que el agente invoca vía `streamText` + una única tabla de conocimiento filtrada por `empresa_id` + frontend con `useChat` para consumir el stream.

**Tech Stack:** Next.js 16 (App Router), Vercel AI SDK v4 (`ai`, `@ai-sdk/openai`, `@ai-sdk/react`), Supabase (`@supabase/supabase-js` + extensión `pgvector`), `pdf-parse`, `mammoth`, `zod`, TypeScript, `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-13-rag-procedimientos-design.md`

## Global Constraints

- Modelo de embeddings: `text-embedding-3-small` (1536 dimensiones) — usado tanto en la ingesta como en la búsqueda.
- Modelo de chat: `gpt-4.1-mini` (ya usado en el proyecto).
- Chunking: ~1500 caracteres por chunk, ~200 caracteres de solapamiento.
- Retrieval: `match_count = 5`, `match_threshold = 0.75` (similitud coseno).
- `maxSteps: 5` en el agente (1 tool call + respuesta, con margen).
- Identificación de empresa: variable de entorno `EMPRESA_ID` (sin auth todavía).
- El proyecto NO tiene test runner instalado y el spec dejó los tests automatizados fuera de alcance salvo `chunking.ts` (lógica pura). Ese único módulo se cubre con el test runner nativo de Node (`node:test` + `node:assert/strict`, sin dependencias nuevas). El resto de las tareas se valida manualmente (correr el script/servidor y verificar en consola, Supabase o el navegador), seguiendo el mismo patrón de logging educativo que ya tiene el proyecto.
- Código, comentarios y mensajes de cara al usuario en español, siguiendo el estilo ya existente en el repo.
- La carpeta `documentos/` en la raíz del repo ya contiene 4 PDFs reales provistos por el usuario (políticas de seguridad HSS, rol de evacuación, incidentes) — se usan como datos de prueba reales en varias tareas.
- El script de ingesta escribe con la Supabase **service role key** (`SUPABASE_SERVICE_ROLE_KEY`, nueva env var, server-side only); el resto de la app sigue leyendo con la anon key ya configurada (`SUPABASE_KEY`, cliente en `src/lib/db.ts`, sin cambios).

---

### Task 1: Esquema de base de datos (pgvector)

**Files:**
- Create: `scripts/setup-schema.sql`

**Interfaces:**
- Produces: tablas `documentos`, `chunks` y función `match_chunks(query_embedding vector(1536), p_empresa_id text, match_count int default 5, match_threshold float default 0.75)` que devuelve `(contenido text, documento text, similitud float)`. Todas las tareas siguientes que tocan la base de datos dependen de este esquema.

- [ ] **Step 1: Escribir el script SQL del esquema**

```sql
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
```

- [ ] **Step 2: Aplicar el script en Supabase**

Abrí el SQL Editor de tu proyecto de Supabase, pegá el contenido completo de `scripts/setup-schema.sql` y ejecutalo (Run / Cmd+Enter).

- [ ] **Step 3: Verificar que el esquema quedó creado**

En el mismo SQL Editor, corré:

```sql
select extname from pg_extension where extname = 'vector';
select table_name from information_schema.tables where table_name in ('documentos', 'chunks');
select proname from pg_proc where proname = 'match_chunks';
```

Expected: la extensión `vector`, ambas tablas y la función `match_chunks` aparecen en los resultados.

- [ ] **Step 4: Commit**

```bash
git add scripts/setup-schema.sql
git commit -m "feat: agregar esquema pgvector para documentos y chunks"
```

---

### Task 2: Módulo de configuración de empresa

**Files:**
- Create: `src/lib/empresa.ts`

**Interfaces:**
- Consumes: `process.env.EMPRESA_ID`
- Produces: `export const EMPRESA_ID: string` — usado por Task 4 (ingesta), Task 5 (rag.ts).

- [ ] **Step 1: Crear el módulo**

```ts
/**
 * Identificador de la empresa activa.
 *
 * Hasta que exista un sistema de autenticación/organizaciones, la empresa
 * se fija por variable de entorno. Todo el contenido ingerido y toda
 * búsqueda quedan filtrados por este valor.
 */

if (!process.env.EMPRESA_ID) {
  throw new Error("EMPRESA_ID no está configurada en las variables de entorno");
}

export const EMPRESA_ID = process.env.EMPRESA_ID;
```

- [ ] **Step 2: Verificar manualmente**

Con `EMPRESA_ID` seteada en tu `.env.local` (ej. `EMPRESA_ID=demo`), corré:

```bash
pnpm exec tsx -e "import('./src/lib/empresa').then(m => console.log('OK:', m.EMPRESA_ID))"
```

Expected: imprime `OK: demo` (o el valor que hayas puesto). Si comentás la línea de `.env.local` y volvés a correrlo, debe lanzar el error `EMPRESA_ID no está configurada...`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/empresa.ts
git commit -m "feat: agregar modulo de configuracion de empresa activa"
```

---

### Task 3: Utilidad de chunking (con test)

**Files:**
- Create: `src/lib/chunking.ts`
- Test: `src/lib/chunking.test.ts`

**Interfaces:**
- Produces: `export function chunkText(text: string, chunkSize?: number, overlap?: number): string[]` — usado por Task 4 (ingesta).

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/lib/chunking.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "./chunking";

test("agrupa parrafos cortos en un solo chunk", () => {
  const texto = "Primer parrafo.\n\nSegundo parrafo.";
  const chunks = chunkText(texto, 1500, 200);

  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].includes("Primer parrafo."));
  assert.ok(chunks[0].includes("Segundo parrafo."));
});

test("separa en varios chunks cuando se supera el tamano maximo", () => {
  const parrafoA = "A".repeat(1000);
  const parrafoB = "B".repeat(1000);
  const texto = `${parrafoA}\n\n${parrafoB}`;
  const chunks = chunkText(texto, 1500, 200);

  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].includes(parrafoA));
  assert.ok(chunks[1].includes(parrafoB));
});

test("mantiene solapamiento entre chunks consecutivos", () => {
  const parrafoA = "A".repeat(1000);
  const parrafoB = "B".repeat(1000);
  const texto = `${parrafoA}\n\n${parrafoB}`;
  const chunks = chunkText(texto, 1500, 200);

  assert.equal(chunks.length, 2);
  assert.ok(chunks[1].startsWith("A".repeat(200)));
});

test("parte un parrafo individual mas largo que el tamano maximo", () => {
  const parrafoLargo = "X".repeat(4000);
  const chunks = chunkText(parrafoLargo, 1500, 200);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 1500);
  }
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `pnpm exec tsx --test src/lib/chunking.test.ts`
Expected: FAIL — `chunking.ts` no existe todavía (`Cannot find module './chunking'`).

- [ ] **Step 3: Implementar `chunkText`**

```ts
// src/lib/chunking.ts
/**
 * Troceo de texto en chunks para indexar en la búsqueda semántica.
 *
 * Agrupa párrafos hasta un tamaño máximo, manteniendo un solapamiento
 * entre chunks consecutivos para no perder contexto en los bordes.
 * Un párrafo individual más largo que el tamaño máximo se parte en bloques.
 */

const CHUNK_SIZE_DEFAULT = 1500;
const CHUNK_OVERLAP_DEFAULT = 200;

export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE_DEFAULT,
  overlap: number = CHUNK_OVERLAP_DEFAULT
): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim().length > 0) {
      chunks.push(current.trim());
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > chunkSize) {
      pushCurrent();
      current = "";
      for (let i = 0; i < paragraph.length; i += chunkSize - overlap) {
        chunks.push(paragraph.slice(i, i + chunkSize));
      }
      continue;
    }

    if (current.length + paragraph.length + 2 > chunkSize) {
      const previous = current;
      pushCurrent();
      const tail = previous.slice(-overlap).trim();
      current = tail ? `${tail}\n\n${paragraph}` : paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  pushCurrent();
  return chunks;
}
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `pnpm exec tsx --test src/lib/chunking.test.ts`
Expected: las 4 pruebas en PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chunking.ts src/lib/chunking.test.ts
git commit -m "feat: agregar utilidad de chunking de texto con tests"
```

---

### Task 4: Script de ingesta de documentos

**Files:**
- Create: `scripts/ingest-docs.ts`
- Modify: `package.json` (agregar dependencias `pdf-parse` y `mammoth`, agregar script `ingest`)

**Interfaces:**
- Consumes: `chunkText` (Task 3, `src/lib/chunking.ts`), `EMPRESA_ID` (Task 2, `src/lib/empresa.ts`), esquema `documentos`/`chunks` (Task 1).
- Produces: comando `pnpm ingest [ruta-opcional]` que puebla las tablas `documentos` y `chunks` en Supabase — usado por Task 5 y Task 7 como fuente de datos real para probar el retrieval end-to-end.

- [ ] **Step 1: Agregar las dependencias**

```bash
pnpm add pdf-parse mammoth
```

- [ ] **Step 2: Agregar el script `ingest` en `package.json`**

En `package.json`, dentro de `"scripts"`, agregar (junto a `"setup-db"`, que se elimina en la Task 8):

```json
"ingest": "tsx scripts/ingest-docs.ts"
```

- [ ] **Step 3: Escribir el script de ingesta**

```ts
// scripts/ingest-docs.ts
/**
 * Script de ingesta de documentos de procedimientos.
 *
 * Lee archivos PDF/Word de una carpeta (por defecto "documentos/"),
 * los trocea, genera embeddings y los guarda en Supabase para que
 * el agente RAG pueda consultarlos.
 *
 * Uso:
 *   pnpm ingest                    -> procesa toda la carpeta documentos/
 *   pnpm ingest documentos/x.pdf   -> procesa un unico archivo
 */

import { createClient } from "@supabase/supabase-js";
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, basename } from "node:path";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { chunkText } from "../src/lib/chunking";
import { EMPRESA_ID } from "../src/lib/empresa";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBED_BATCH_SIZE = 100;
const CARPETA_DEFAULT = "documentos";

if (!process.env.SUPABASE_URL) {
  throw new Error("SUPABASE_URL no está configurada en las variables de entorno");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY no está configurada en las variables de entorno");
}

// Cliente admin (service role): puede escribir sin restricciones de RLS.
// Se usa EXCLUSIVAMENTE en este script server-side, nunca en el código de la app.
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

type TipoDocumento = "pdf" | "docx";

function detectarTipo(nombreArchivo: string): TipoDocumento | null {
  const ext = extname(nombreArchivo).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".docx") return "docx";
  return null;
}

async function extraerTexto(rutaArchivo: string, tipo: TipoDocumento): Promise<string> {
  const buffer = await readFile(rutaArchivo);

  if (tipo === "pdf") {
    const resultado = await pdfParse(buffer);
    return resultado.text;
  }

  const resultado = await mammoth.extractRawText({ buffer });
  return resultado.value;
}

async function borrarDocumentoExistente(nombre: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("documentos")
    .delete()
    .eq("empresa_id", EMPRESA_ID)
    .eq("nombre", nombre);

  if (error) {
    throw new Error(`Error borrando documento existente "${nombre}": ${error.message}`);
  }
}

async function ingestarArchivo(rutaArchivo: string): Promise<number> {
  const nombre = basename(rutaArchivo);
  const tipo = detectarTipo(nombre);

  if (!tipo) {
    console.warn(`⚠️  [INGESTA] "${nombre}" no es PDF ni Word, se omite.`);
    return 0;
  }

  console.log(`📄 [INGESTA] Procesando "${nombre}"...`);

  const texto = await extraerTexto(rutaArchivo, tipo);
  const chunks = chunkText(texto);

  if (chunks.length === 0) {
    console.warn(`⚠️  [INGESTA] "${nombre}" no generó contenido para indexar, se omite.`);
    return 0;
  }

  // Idempotencia: si ya existe, lo reemplazamos por completo (cascade borra sus chunks)
  await borrarDocumentoExistente(nombre);

  const { data: documento, error: errorDocumento } = await supabaseAdmin
    .from("documentos")
    .insert({ empresa_id: EMPRESA_ID, nombre, tipo })
    .select()
    .single();

  if (errorDocumento || !documento) {
    throw new Error(`Error insertando documento "${nombre}": ${errorDocumento?.message}`);
  }

  let chunksInsertados = 0;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const lote = chunks.slice(i, i + EMBED_BATCH_SIZE);

    const { embeddings } = await embedMany({
      model: openai.embedding(EMBEDDING_MODEL),
      values: lote,
    });

    const filas = lote.map((contenido, idx) => ({
      documento_id: documento.id,
      empresa_id: EMPRESA_ID,
      contenido,
      embedding: embeddings[idx],
      metadata: { chunk_index: i + idx },
    }));

    const { error: errorChunks } = await supabaseAdmin.from("chunks").insert(filas);

    if (errorChunks) {
      throw new Error(`Error insertando chunks de "${nombre}": ${errorChunks.message}`);
    }

    chunksInsertados += filas.length;
    console.log(`   ✅ ${chunksInsertados}/${chunks.length} chunks indexados`);
  }

  return chunksInsertados;
}

async function main() {
  const argumento = process.argv[2];
  const archivos: string[] = [];

  if (argumento) {
    archivos.push(argumento);
  } else {
    const nombresEnCarpeta = await readdir(CARPETA_DEFAULT);
    archivos.push(...nombresEnCarpeta.map((n) => join(CARPETA_DEFAULT, n)));
  }

  console.log(`🚀 [INGESTA] Empresa: ${EMPRESA_ID} — ${archivos.length} archivo(s) a procesar\n`);

  let documentosOk = 0;
  let documentosError = 0;
  let chunksTotales = 0;

  for (const archivo of archivos) {
    try {
      const chunksInsertados = await ingestarArchivo(archivo);
      if (chunksInsertados > 0) {
        documentosOk++;
        chunksTotales += chunksInsertados;
      }
    } catch (error) {
      documentosError++;
      console.error(
        `❌ [INGESTA] Error procesando "${archivo}":`,
        error instanceof Error ? error.message : error
      );
    }
  }

  console.log(
    `\n📊 [INGESTA] Resumen: ${documentosOk} documento(s) ok, ${documentosError} con error, ${chunksTotales} chunks totales.`
  );
}

main().catch((error) => {
  console.error("❌ [INGESTA] Error fatal:", error);
  process.exit(1);
});
```

- [ ] **Step 4: Configurar variables de entorno necesarias**

En tu `.env.local` (no versionado), asegurate de tener:

```
SUPABASE_URL=...
SUPABASE_KEY=...              # anon key, ya existente
SUPABASE_SERVICE_ROLE_KEY=... # nueva: Settings > API > service_role, solo para este script
OPENAI_API_KEY=...
EMPRESA_ID=demo
```

- [ ] **Step 5: Correr la ingesta real contra los documentos ya provistos**

Run: `pnpm ingest`
Expected: en consola, una línea `📄 [INGESTA] Procesando "..."` por cada uno de los 4 PDFs en `documentos/`, con su conteo de chunks indexados, y al final `📊 [INGESTA] Resumen: 4 documento(s) ok, 0 con error, N chunks totales.`

- [ ] **Step 6: Verificar en Supabase**

En el SQL Editor:

```sql
select nombre, tipo from documentos where empresa_id = 'demo';
select count(*) from chunks where empresa_id = 'demo';
```

Expected: las 4 filas de `documentos` (una por PDF) y un `count` de chunks mayor a 0, todos con `embedding` no nulo.

- [ ] **Step 7: Verificar idempotencia (re-ingestar no duplica)**

Anotá el `count` de chunks del Step 6, después volvé a correr:

Run: `pnpm ingest`
Expected: mismo resumen final (`4 documento(s) ok`). Repetí la consulta `select count(*) from chunks where empresa_id = 'demo';` del Step 6: el conteo debe ser igual al anotado antes, no el doble — confirma que el script reemplazó los chunks existentes en vez de duplicarlos.

- [ ] **Step 8: Commit**

```bash
git add scripts/ingest-docs.ts package.json pnpm-lock.yaml
git commit -m "feat: agregar script de ingesta de documentos PDF/Word"
```

---

### Task 5: Tool de retrieval (`buscarProcedimientos`)

**Files:**
- Create: `src/lib/rag.ts`

**Interfaces:**
- Consumes: `supabase` (`src/lib/db.ts`, cliente existente con anon key), `EMPRESA_ID` (Task 2), función SQL `match_chunks` (Task 1), datos reales cargados en Task 4.
- Produces: `export interface ResultadoBusqueda { contenido: string; documento: string; similitud: number }`, `export async function buscarChunks(consulta: string): Promise<ResultadoBusqueda[]>`, `export const toolBuscarProcedimientos: { description: string; parameters: ZodSchema; execute: (args: { consulta: string }) => Promise<...> }` — usado por Task 6 (endpoint).

- [ ] **Step 1: Escribir `src/lib/rag.ts`**

```ts
/**
 * Tool RAG: búsqueda semántica sobre los procedimientos de la empresa.
 */

import { z } from "zod";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { supabase } from "./db";
import { EMPRESA_ID } from "./empresa";

const EMBEDDING_MODEL = "text-embedding-3-small";
const MATCH_COUNT = 5;
const MATCH_THRESHOLD = 0.75;

export interface ResultadoBusqueda {
  contenido: string;
  documento: string;
  similitud: number;
}

export async function buscarChunks(consulta: string): Promise<ResultadoBusqueda[]> {
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: consulta,
  });

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    p_empresa_id: EMPRESA_ID,
    match_count: MATCH_COUNT,
    match_threshold: MATCH_THRESHOLD,
  });

  if (error) {
    throw new Error(`Error buscando en procedimientos: ${error.message}`);
  }

  return data ?? [];
}

export const toolBuscarProcedimientos = {
  description:
    "Busca información en los procedimientos internos de la empresa (políticas, normativas, instructivos). Úsala SIEMPRE antes de responder cualquier consulta sobre procedimientos.",
  parameters: z.object({
    consulta: z.string().describe("La pregunta o tema a buscar en los procedimientos"),
  }),
  execute: async ({ consulta }: { consulta: string }) => {
    console.log(`🔍 [TOOL] buscarProcedimientos: "${consulta}"`);
    try {
      const resultados = await buscarChunks(consulta);
      console.log(`   ✅ ${resultados.length} resultado(s) relevante(s) encontrados`);
      return resultados;
    } catch (error) {
      console.error("   ❌ Error en buscarProcedimientos:", error);
      return {
        error: true,
        mensaje: "Hubo un problema buscando en los procedimientos. Intentá de nuevo.",
      };
    }
  },
};
```

- [ ] **Step 2: Verificar manualmente contra los datos reales ya ingeridos**

Run:

```bash
pnpm exec tsx -e "import('./src/lib/rag').then(async m => console.log(await m.buscarChunks('cuales son las reglas de oro de seguridad')))"
```

Expected: imprime un array con al menos un resultado, con `documento` conteniendo `"A-POL-HSS-01-A"` (el PDF de reglas de oro) y `similitud` >= 0.75.

- [ ] **Step 3: Commit**

```bash
git add src/lib/rag.ts
git commit -m "feat: agregar tool de retrieval buscarProcedimientos"
```

---

### Task 6: Endpoint del chat con streaming

**Files:**
- Modify: `src/app/api/chat/route.ts` (reescritura completa)

**Interfaces:**
- Consumes: `toolBuscarProcedimientos` (Task 5, `src/lib/rag.ts`).
- Produces: `POST /api/chat` que devuelve un `Response` en formato data-stream compatible con `useChat` — usado por Task 7 (frontend).

- [ ] **Step 1: Reescribir el endpoint**

```ts
// src/app/api/chat/route.ts
/**
 * API Route para el chat del agente RAG de procedimientos.
 *
 * Recibe los mensajes del usuario y responde en streaming usando Vercel AI SDK
 * con el modelo GPT-4.1-mini. El agente usa la tool buscarProcedimientos para
 * responder solo en base a los documentos indexados de la empresa.
 */

import { openai } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { toolBuscarProcedimientos } from "@/lib/rag";

const model = openai("gpt-4.1-mini");
const MAX_STEPS = 5;

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model,
    messages,
    tools: {
      buscarProcedimientos: tool({
        description: toolBuscarProcedimientos.description,
        parameters: toolBuscarProcedimientos.parameters,
        execute: toolBuscarProcedimientos.execute,
      }),
    },
    maxSteps: MAX_STEPS,
    system: `Eres un asistente virtual especializado EXCLUSIVAMENTE en responder consultas sobre los procedimientos internos de la empresa (políticas de seguridad, normativas, instructivos).

🔒 REGLAS DE SEGURIDAD Y ALCANCE:
1. **SOLO PROCEDIMIENTOS DE LA EMPRESA:** Rechaza amablemente cualquier consulta que no sea sobre los procedimientos internos.
2. **NO INVENTAR:** Usa SIEMPRE la tool buscarProcedimientos antes de responder. Si no encuentra información relevante, dilo explícitamente en vez de inventar una respuesta.
3. **CITAR LA FUENTE:** Al responder, menciona el nombre del documento del que sacaste la información.

Sé claro, profesional y directo.`,
  });

  return result.toDataStreamResponse({
    getErrorMessage: (error) => {
      console.error("Error en el stream del chat:", error);
      return error instanceof Error ? error.message : "Error desconocido";
    },
  });
}
```

- [ ] **Step 2: Verificar manualmente con el servidor corriendo**

En una terminal: `pnpm dev`
En otra terminal:

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Cuales son las reglas de oro de seguridad?"}]}'
```

Expected: la respuesta llega en streaming (chunks de texto uno tras otro, no todo de una vez) y el contenido final menciona el PDF de reglas de oro de seguridad como fuente.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: migrar endpoint del chat a streaming con tool RAG"
```

---

### Task 7: Frontend con `useChat`

**Files:**
- Modify: `src/app/page.tsx` (reescritura completa)
- Modify: `package.json` (agregar dependencia `@ai-sdk/react`)

**Interfaces:**
- Consumes: `POST /api/chat` (Task 6), `useChat` de `@ai-sdk/react`.
- Produces: UI de chat funcional consumiendo el stream — deliverable final visible al usuario.

- [ ] **Step 1: Agregar la dependencia**

```bash
pnpm add @ai-sdk/react
```

- [ ] **Step 2: Reescribir `src/app/page.tsx`**

```tsx
"use client";

/**
 * Componente principal de la aplicación.
 *
 * Interfaz de chat que permite consultar los procedimientos internos
 * de la empresa. Usa useChat del AI SDK para manejar el streaming
 * de la respuesta del agente.
 */

import { useChat } from "@ai-sdk/react";
import styles from "./page.module.css";

export default function Home() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error } = useChat({
    api: "/api/chat",
  });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>Asistente de Procedimientos</h1>
        <p className={styles.subtitle}>
          Consultá las políticas y procedimientos internos de la empresa
        </p>
      </div>

      <div className={styles.chatContainer}>
        <div className={styles.messages}>
          {messages.length === 0 && (
            <div className={`${styles.message} ${styles.assistantMessage}`}>
              <div className={styles.messageContent}>
                ¡Hola! Puedo responder tus consultas sobre los procedimientos y políticas
                internas de la empresa. ¿En qué puedo ayudarte?
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`${styles.message} ${
                message.role === "user" ? styles.userMessage : styles.assistantMessage
              }`}
            >
              <div className={styles.messageContent}>{message.content}</div>
            </div>
          ))}

          {isLoading && (
            <div className={`${styles.message} ${styles.assistantMessage}`}>
              <div className={styles.messageContent}>
                <span className={styles.typing}>Buscando en procedimientos...</span>
              </div>
            </div>
          )}

          {error && (
            <div className={`${styles.message} ${styles.assistantMessage}`}>
              <div className={styles.messageContent}>
                Hubo un error al procesar tu mensaje. Por favor intentá nuevamente.
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Escribí tu consulta sobre procedimientos..."
            className={styles.input}
            disabled={isLoading}
          />
          <button type="submit" className={styles.button} disabled={isLoading || !input.trim()}>
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Probar los 3 escenarios de validación en el navegador**

Run: `pnpm dev` y abrir `http://localhost:3000`

Probar, en orden:
1. **Pregunta cubierta:** `"¿Cuáles son las reglas de oro de seguridad?"` → Expected: responde con contenido real del PDF y cita el nombre del documento.
2. **Pregunta fuera de dominio:** `"¿Cuál es la capital de Francia?"` → Expected: la rechaza amablemente indicando que solo responde sobre procedimientos de la empresa.
3. **Pregunta no documentada:** `"¿Cuál es la política de vacaciones?"` (tema no cubierto por los 4 PDFs actuales) → Expected: dice explícitamente que no encontró esa información en los procedimientos, sin inventar una respuesta.

Verificar también que el texto aparece incrementalmente (streaming) y que se ve el indicador "Buscando en procedimientos..." mientras corre.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx package.json pnpm-lock.yaml
git commit -m "feat: migrar frontend a useChat para consumir el streaming"
```

---

### Task 8: Limpieza del código de turnos y documentación

**Files:**
- Delete: `src/lib/turnos.ts`, `src/lib/tools.ts`, `src/lib/validaciones.ts`, `src/lib/email.ts`, `scripts/setup-db.sql`, `scripts/setup-db.ts`
- Modify: `package.json` (quitar script `setup-db`, dependencias `nodemailer`, `resend`, `@types/nodemailer`; renombrar `name`)
- Modify: `.gitignore` (agregar `/documentos`)
- Modify: `README.md` (reescritura completa)

**Interfaces:**
- Consumes: nada nuevo — cierra el trabajo verificando que ningún archivo restante referencia lo borrado.

- [ ] **Step 1: Borrar los archivos de turnos**

```bash
git rm src/lib/turnos.ts src/lib/tools.ts src/lib/validaciones.ts src/lib/email.ts scripts/setup-db.sql scripts/setup-db.ts
```

- [ ] **Step 2: Limpiar `package.json`**

Quitar de `"scripts"` la línea `"setup-db": "tsx scripts/setup-db.ts"`.
Quitar de `"dependencies"` las líneas `"nodemailer": "^8.0.1"` y `"resend": "^6.9.2"`.
Quitar de `"devDependencies"` la línea `"@types/nodemailer": "^7.0.9"`.
Cambiar `"name": "mi-turno"` por `"name": "agente-procedimientos"`.

- [ ] **Step 3: Sincronizar dependencias**

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` se actualiza quitando `nodemailer`/`resend` y sus subdependencias, sin errores.

- [ ] **Step 4: Agregar `documentos/` a `.gitignore`**

En `.gitignore`, agregar al final:

```
# documentos de procedimientos (contenido propio de cada empresa)
/documentos
```

- [ ] **Step 5: Reescribir `README.md`**

```markdown
# Agente RAG de Procedimientos

Aplicación Next.js que permite a los empleados consultar por chat los procedimientos internos de la empresa (políticas de seguridad, normativas, instructivos), usando RAG (Retrieval-Augmented Generation) sobre documentos PDF/Word indexados en Supabase con pgvector.

## 🎯 Objetivo

El agente responde preguntas en lenguaje natural basándose **únicamente** en los documentos de procedimientos que fueron indexados, citando siempre la fuente. Si no encuentra información relevante, lo dice explícitamente en vez de inventar una respuesta.

## 🚀 Inicio Rápido

### Prerrequisitos

- Node.js 18+ instalado
- Una cuenta en [Supabase](https://supabase.com) con la extensión `pgvector` disponible
- Una API Key de [OpenAI](https://platform.openai.com/api-keys)

### Paso 1: Instalar dependencias

```bash
pnpm install
```

### Paso 2: Configurar variables de entorno

Creá un archivo `.env.local` en la raíz con:

```env
SUPABASE_URL=tu_supabase_url
SUPABASE_KEY=tu_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=tu_supabase_service_role_key
OPENAI_API_KEY=tu_openai_api_key
EMPRESA_ID=demo
```

- `SUPABASE_URL` / `SUPABASE_KEY`: Settings > API en tu proyecto de Supabase (anon key).
- `SUPABASE_SERVICE_ROLE_KEY`: Settings > API > service_role — solo se usa en el script de ingesta, nunca se expone al cliente.
- `EMPRESA_ID`: identificador libre de la empresa activa (no hay multi-usuario/auth todavía, así que todo el contenido indexado queda bajo este identificador).

### Paso 3: Crear el esquema de base de datos

1. Abrí el SQL Editor de tu proyecto en Supabase.
2. Copiá y pegá el contenido de `scripts/setup-schema.sql`.
3. Ejecutalo (Run).

Esto habilita `pgvector` y crea las tablas `documentos`/`chunks` y la función `match_chunks`.

### Paso 4: Cargar los procedimientos

1. Colocá tus archivos PDF o Word en la carpeta `documentos/` (creala si no existe; no se versiona en git).
2. Corré:

```bash
pnpm ingest
```

Esto procesa todos los archivos de la carpeta: extrae el texto, lo trocea, genera embeddings y los guarda en Supabase. También podés ingestar un archivo puntual:

```bash
pnpm ingest documentos/mi-archivo.pdf
```

Volver a correr `pnpm ingest` sobre un archivo ya cargado reemplaza su contenido indexado (no duplica).

### Paso 5: Ejecutar la aplicación

```bash
pnpm dev
```

Abrí [http://localhost:3000](http://localhost:3000).

## 📁 Estructura del Proyecto

```
gestion_turnos/
├── documentos/                 # PDFs/Word a indexar (no versionado)
├── scripts/
│   ├── setup-schema.sql        # Esquema pgvector (tablas + función de búsqueda)
│   └── ingest-docs.ts          # Script de ingesta (extrae, trocea, embebe, guarda)
├── src/
│   ├── lib/
│   │   ├── db.ts                # Cliente de Supabase (anon key, lectura)
│   │   ├── empresa.ts           # EMPRESA_ID activa
│   │   ├── chunking.ts          # Troceo de texto
│   │   └── rag.ts               # Tool buscarProcedimientos (embedding + búsqueda)
│   └── app/
│       ├── api/chat/route.ts    # Endpoint del chat (streaming)
│       ├── page.tsx             # Interfaz de chat (useChat)
│       └── page.module.css
└── README.md
```

## 🛠️ Cómo Funciona

1. **Ingesta (`scripts/ingest-docs.ts`):** lee PDF/Word de `documentos/`, extrae texto, lo trocea en fragmentos con solapamiento, genera embeddings con `text-embedding-3-small` y los guarda en la tabla `chunks` de Supabase, asociados a `documentos` y a la `EMPRESA_ID` activa.
2. **Consulta (`src/lib/rag.ts`):** ante cada pregunta, el agente llama a la tool `buscarProcedimientos`, que embebe la consulta y busca los chunks más similares vía la función SQL `match_chunks` (similitud coseno, filtrada por empresa).
3. **Respuesta (`src/app/api/chat/route.ts`):** el modelo (`gpt-4.1-mini`) usa esos resultados para responder en streaming, citando el documento fuente, o admite que no tiene esa información si no hubo resultados relevantes.
4. **Frontend (`src/app/page.tsx`):** usa `useChat` del AI SDK para mostrar la conversación con el texto apareciendo incrementalmente.

## 🔧 Tecnologías Utilizadas

- **Next.js 16**: Framework React con App Router
- **Vercel AI SDK**: `streamText`, `embed`/`embedMany`, `useChat`
- **OpenAI**: `gpt-4.1-mini` (chat) y `text-embedding-3-small` (embeddings)
- **Supabase + pgvector**: almacenamiento y búsqueda semántica
- **pdf-parse / mammoth**: extracción de texto de PDF y Word
- **Zod**: validación de schemas de tools
- **TypeScript**

## 🐛 Solución de Problemas

### Error: "SUPABASE_URL no está configurada" / "EMPRESA_ID no está configurada"

Revisá que tu `.env.local` tenga todas las variables del Paso 2.

### `pnpm ingest` no encuentra archivos

Confirmá que la carpeta `documentos/` existe en la raíz del proyecto y tiene al menos un `.pdf` o `.docx`.

### El agente dice que no tiene información sobre algo que sí está en un PDF

Puede que ese documento no se haya ingerido todavía, o que la similitud del resultado haya quedado por debajo del umbral (`match_threshold = 0.75` en `src/lib/rag.ts`). Verificá con `pnpm ingest` que el documento esté cargado.
```

- [ ] **Step 6: Verificar que el proyecto compila sin referencias rotas**

Run: `pnpm build`
Expected: build exitoso, sin errores de módulos no encontrados (`turnos`, `tools`, `validaciones`, `email`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: eliminar codigo de turnos y actualizar documentacion"
```
