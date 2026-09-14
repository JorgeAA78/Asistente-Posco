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
