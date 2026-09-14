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
