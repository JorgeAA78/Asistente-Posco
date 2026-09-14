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

  // El indicador "Buscando..." solo debe mostrarse mientras esperamos el
  // primer token/tool-call. Una vez que el mensaje del asistente empieza a
  // tener contenido real en streaming, el indicador debe desaparecer en vez
  // de quedar debajo del texto durante toda la respuesta.
  const ultimoMensaje = messages[messages.length - 1];
  const ultimoMensajeAsistenteTieneContenido =
    ultimoMensaje?.role === "assistant" && ultimoMensaje.content.length > 0;

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

          {isLoading && !ultimoMensajeAsistenteTieneContenido && (
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
