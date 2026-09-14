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
import { PDFParse } from "pdf-parse";
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
    // pdf-parse v2 expone una clase PDFParse en lugar de la función
    // callable de v1 (pdfParse(buffer) -> { text }).
    const parser = new PDFParse({ data: buffer });
    try {
      const resultado = await parser.getText();
      return resultado.text;
    } finally {
      await parser.destroy();
    }
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
