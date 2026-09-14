/**
 * Tool RAG: búsqueda semántica sobre los procedimientos de la empresa.
 */

import { z } from "zod";
import { embed } from "ai";
import { openai } from "@ai-sdk/openai";
import { supabase } from "./db";
import { EMPRESA_ID } from "./empresa";
import { EMBEDDING_MODEL } from "./embeddings";

// Valores calibrados empíricamente contra los datos reales de PDFs de la
// empresa ya ingeridos (2026-09-13/14): las consultas relacionadas con el
// dominio (procedimientos reales) puntuaron una similitud de 0.49-0.66,
// contenido de un dominio no relacionado topeó en 0.43, y contenido
// completamente fuera de tema en 0.09. 0.45 separa con margen la banda
// "on-topic" del resto. A medida que se agreguen más documentos, puede
// requerir re-calibración.
const MATCH_COUNT = 5;
const MATCH_THRESHOLD = 0.45;

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
