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
