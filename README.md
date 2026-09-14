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

Puede que ese documento no se haya ingerido todavía, o que la similitud del resultado haya quedado por debajo del umbral (`match_threshold = 0.45` en `src/lib/rag.ts`). Verificá con `pnpm ingest` que el documento esté cargado.

### Un PDF se ingiere pero el agente no puede responder sobre su contenido

Algunos PDFs protegidos con IRM (Information Rights Management) de Microsoft no permiten extraer su texto real — el script los ingiere igual, pero solo con un mensaje de "no autorizado a ver" en vez del contenido real. Si esto pasa, necesitás una versión del archivo sin esa protección.
