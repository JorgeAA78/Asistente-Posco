/**
 * API Route para el chat del agente RAG de procedimientos.
 *
 * Recibe los mensajes del usuario y responde en streaming usando Vercel AI SDK
 * con el modelo GPT-4.1-mini. El agente usa la tool buscarProcedimientos para
 * responder solo en base a los documentos indexados de la empresa.
 */

import { openai } from "@ai-sdk/openai";
import { streamText, tool } from "ai";
import { z } from "zod";
import { toolBuscarProcedimientos } from "@/lib/rag";

const model = openai("gpt-5-mini");
const MAX_STEPS = 5;

// Solo "user"/"assistant": el schema del SDK acepta role "system", lo que
// permitiría a un cliente malicioso inyectar su propio mensaje de sistema
// y pisar las reglas de alcance/citación de abajo. Se rechaza cualquier otro
// rol en vez de forwardearlo tal cual a streamText.
const mensajeSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const requestSchema = z.object({
  messages: z.array(mensajeSchema).min(1),
});

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json(
        { error: "El cuerpo de la petición no es un JSON válido." },
        { status: 400 }
      );
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: "Petición inválida.", detalles: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { messages } = parsed.data;

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
  } catch (error) {
    console.error("Error inesperado en /api/chat:", error);
    return Response.json(
      { error: "Error inesperado procesando la consulta." },
      { status: 500 }
    );
  }
}
