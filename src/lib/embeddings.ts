/**
 * Constantes del modelo de embeddings usado tanto en la ingesta
 * (scripts/ingest-docs.ts) como en la búsqueda (src/lib/rag.ts).
 *
 * EMBEDDING_DIMENSIONS debe coincidir con el tipo `vector(1536)` de la
 * columna `chunks.embedding` en scripts/setup-schema.sql — SQL no puede
 * importar esta constante, así que si se cambia el modelo de embeddings
 * hay que actualizar el esquema a mano.
 */

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;
