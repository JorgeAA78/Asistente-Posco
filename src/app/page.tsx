"use client";

/**
 * Componente principal del Asistente de Procedimientos.
 * Adaptado con diseño responsivo para Mobile y Desktop.
 */

import { useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import styles from "./page.module.css";

const SUGERENCIAS = [
  {
    icon: "🛡️",
    texto: "¿Cuáles son las políticas de seguridad de la empresa?",
  },
  {
    icon: "⚠️",
    texto: "¿Cómo reportar un incidente de trabajo?",
  },
  {
    icon: "📅",
    texto: "¿Cuál es la normativa sobre descansos y licencias?",
  },
  {
    icon: "🚪",
    texto: "¿Cuáles son los instructivos de acceso a planta?",
  },
];

export default function Home() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, error, setMessages, append } = useChat({
    api: "/api/chat",
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll al final con cada token o cambio de mensajes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const ultimoMensaje = messages[messages.length - 1];
  const ultimoMensajeAsistenteTieneContenido =
    ultimoMensaje?.role === "assistant" && ultimoMensaje.content.length > 0;

  const handleSelectSuggestion = (texto: string) => {
    if (isLoading) return;
    append({ role: "user", content: texto });
  };

  const handleResetChat = () => {
    if (isLoading) return;
    setMessages([]);
  };

  /**
   * Renderiza el texto con formato amigable (negritas, viñetas y fuentes)
   */
  const renderMessageText = (text: string) => {
    const lines = text.split("\n");
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return <div key={idx} style={{ height: 6 }} />;

      // Detección de cita de fuente documental
      if (/^(fuente|documento|archivo|referencia):/i.test(trimmed)) {
        return (
          <div key={idx} className={styles.sourceBadge}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span>{trimmed}</span>
          </div>
        );
      }

      // Detección de viñetas
      const isBullet = trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("• ");
      const content = isBullet ? trimmed.replace(/^[-*•]\s+/, "") : trimmed;

      // Parseo básico de **negritas**
      const parts = content.split(/(\*\*.*?\*\*)/g);
      const parsedElements = parts.map((part, pIdx) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={pIdx}>{part.slice(2, -2)}</strong>;
        }
        return part;
      });

      if (isBullet) {
        return (
          <div key={idx} style={{ display: "flex", gap: "8px", margin: "4px 0", paddingLeft: "4px" }}>
            <span style={{ color: "#38bdf8" }}>•</span>
            <span>{parsedElements}</span>
          </div>
        );
      }

      return (
        <p key={idx} className={styles.bubbleParagraph}>
          {parsedElements}
        </p>
      );
    });
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.backgroundGlow} />

      <div className={styles.container}>
        {/* Cabecera optimizada para Desktop y Mobile */}
        <header className={styles.header}>
          <div className={styles.brandGroup}>
            <div className={styles.brandIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            <div className={styles.brandText}>
              <h1 className={styles.title}>
                Asistente de Procedimientos
              </h1>
              <p className={styles.subtitle}>
                Políticas, normativas y reglamentos de la empresa
              </p>
            </div>
          </div>

          <div className={styles.headerActions}>
            <div className={styles.statusPill}>
              <div className={styles.statusDot} />
              <span>Conectado</span>
            </div>

            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleResetChat}
                className={styles.resetButton}
                title="Reiniciar conversación"
                disabled={isLoading}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
                  <path d="M21 3v5h-5"></path>
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
                  <path d="M3 21v-5h5"></path>
                </svg>
                <span>Nuevo</span>
              </button>
            )}
          </div>
        </header>

        {/* Tarjeta de Chat */}
        <main className={styles.chatCard}>
          <div className={styles.messagesArea}>
            {messages.length === 0 ? (
              <div className={styles.welcomeContainer}>
                <div className={styles.welcomeIconWrapper}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                </div>
                <h2 className={styles.welcomeTitle}>¿En qué puedo ayudarte hoy?</h2>
                <p className={styles.welcomeSubtitle}>
                  Estoy conectado a los documentos y manuales oficiales de la empresa para responder tus dudas operativas y normativas al instante.
                </p>

                <div className={styles.suggestionsTitle}>Consultas sugeridas</div>
                <div className={styles.suggestionsGrid}>
                  {SUGERENCIAS.map((sug, i) => (
                    <button
                      key={i}
                      type="button"
                      className={styles.suggestionCard}
                      onClick={() => handleSelectSuggestion(sug.texto)}
                    >
                      <span className={styles.suggestionIcon}>{sug.icon}</span>
                      <span>{sug.texto}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div
                    key={message.id}
                    className={`${styles.messageRow} ${isUser ? styles.userRow : styles.assistantRow}`}
                  >
                    <div className={`${styles.avatar} ${isUser ? styles.userAvatar : styles.assistantAvatar}`}>
                      {isUser ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                          <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"></path>
                          <rect x="4" y="8" width="16" height="12" rx="2"></rect>
                          <circle cx="9" cy="13" r="1"></circle>
                          <circle cx="15" cy="13" r="1"></circle>
                        </svg>
                      )}
                    </div>
                    <div className={`${styles.bubble} ${isUser ? styles.userBubble : styles.assistantBubble}`}>
                      {renderMessageText(message.content)}
                    </div>
                  </div>
                );
              })
            )}

            {isLoading && !ultimoMensajeAsistenteTieneContenido && (
              <div className={`${styles.messageRow} ${styles.assistantRow}`}>
                <div className={`${styles.avatar} ${styles.assistantAvatar}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"></path>
                    <rect x="4" y="8" width="16" height="12" rx="2"></rect>
                  </svg>
                </div>
                <div className={styles.loadingBubble}>
                  <span>Consultando procedimientos</span>
                  <div className={styles.typingDots}>
                    <span className={styles.typingDot} />
                    <span className={styles.typingDot} />
                    <span className={styles.typingDot} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className={styles.errorBanner}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>Ocurrió un error al procesar tu consulta. Por favor intentá nuevamente.</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Formulario de Entrada */}
          <div className={styles.formContainer}>
            {messages.length > 0 && (
              <div className={styles.activeSuggestions}>
                {SUGERENCIAS.slice(0, 3).map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    className={styles.chip}
                    onClick={() => handleSelectSuggestion(sug.texto)}
                    disabled={isLoading}
                  >
                    {sug.texto}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={handleSubmit} className={styles.inputGroup}>
              <input
                type="text"
                value={input}
                onChange={handleInputChange}
                placeholder="Escribí tu consulta sobre procedimientos..."
                className={styles.inputField}
                disabled={isLoading}
              />
              <button
                type="submit"
                className={styles.sendButton}
                disabled={isLoading || !input.trim()}
                title="Enviar mensaje"
              >
                <span>Enviar</span>
                <svg className={styles.sendIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
}
