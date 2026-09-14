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

test("no entra en loop infinito cuando overlap >= chunkSize", () => {
  const parrafoLargo = "Y".repeat(5000);

  // overlap === chunkSize haria que el paso del loop fuera 0 sin el guard;
  // overlap > chunkSize lo haria negativo. Probamos ambos casos y solo
  // afirmamos que la funcion retorna (si hay guard, retorna casi al
  // instante; sin guard, este test cuelga y el runner lo mata por timeout).
  const chunksIgual = chunkText(parrafoLargo, 1500, 1500);
  assert.ok(chunksIgual.length > 0);

  const chunksMayor = chunkText(parrafoLargo, 1500, 2000);
  assert.ok(chunksMayor.length > 0);
});
