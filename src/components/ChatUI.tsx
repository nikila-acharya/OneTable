/**
 * WP-5.1 — Chat UI Component: Household agent chat with rich cards
 * Displays agent responses, approval cards, recipe cards, plan diffs
 * Supports streaming, real-time updates, undo buttons
 * Integrates with Coordinator for request/response lifecycle
 */

import React, { useState, useRef, useEffect } from "react";
import type { CoordinatorResponse, RichCard } from "@/agent/coordinator";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  cards?: RichCard[];
  actionLogLink?: string;
  toolName?: string;
}

/** Card payloads are built dynamically by agents, so read them defensively. */
const asText = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : String(v));
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(asText) : []);

export interface ChatUIProps {
  householdId: string;
  onSendMessage: (message: string) => Promise<CoordinatorResponse>;
  initialMessages?: ChatMessage[];
}

/**
 * Rich card renderer (plan diff, recipe, approval, summary, etc.)
 */
function RichCardComponent({ card }: { card: RichCard }): React.JSX.Element {
  switch (card.type) {
    case "plan_diff":
      return (
        <div className="card card-plan-diff">
          <h4>{card.title}</h4>
          <pre>{JSON.stringify(card.content, null, 2)}</pre>
        </div>
      );

    case "recipe":
      return (
        <div className="card card-recipe">
          <h4>{card.title}</h4>
          <p>{asText(card.content.description)}</p>
          <div className="recipe-meta">
            <span>🕐 {asText(card.content.prepMinutes)}m prep</span>
            <span>🔥 {asText(card.content.cookMinutes)}m cook</span>
            <span>⚡ {asText(card.content.caloriesPerServing)} kcal</span>
          </div>
          <ul>
            {asList(card.content.ingredients).map((ing, i) => (
              <li key={i}>{ing}</li>
            ))}
          </ul>
        </div>
      );

    case "approval":
      return (
        <div className="card card-approval">
          <h4>{card.title}</h4>
          <p className="approval-summary">{asText(card.content.summary)}</p>
          <div className="approval-actions">
            {card.actionButtons?.map((btn) => (
              <button
                key={btn.actionId}
                className={`btn btn-${btn.action}`}
                onClick={() => console.log(`Action: ${btn.action}`)}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>
      );

    case "summary":
      return (
        <div className="card card-summary">
          <h4>{card.title}</h4>
          <ul>
            {Object.entries(card.content).map(([key, value]) => (
              <li key={key}>
                <strong>{key}:</strong> {String(value)}
              </li>
            ))}
          </ul>
        </div>
      );

    case "message":
      return (
        <div className="card card-message">
          <p>{asText(card.content.text)}</p>
        </div>
      );

    default:
      return (
        <div className="card card-unknown">
          <p>{JSON.stringify(card.content)}</p>
        </div>
      );
  }
}

/**
 * Chat UI Component
 */
export function ChatUI({ householdId, onSendMessage, initialMessages = [] }: ChatUIProps): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: input,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      // Get response from Coordinator
      const response = await onSendMessage(input);

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-resp`,
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
        cards: response.cards,
        toolName: response.delegationsSummary?.agentsInvolved?.[0],
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      // Add error message
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-ui">
      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <h2>Welcome to OneTable</h2>
            <p>I&apos;m your household meal and health agent. How can I help?</p>
            <div className="quick-actions">
              <button onClick={() => setInput("Plan meals for next week")}>
                📅 Plan meals
              </button>
              <button onClick={() => setInput("What should we cook today?")}>
                🍽️ What&apos;s for dinner?
              </button>
              <button onClick={() => setInput("Show activity goals")}>
                🏃 Activity
              </button>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`message message-${msg.role}`}>
            {/* Message text */}
            <div className="message-content">
              {msg.role === "assistant" && (
                <div className="message-header">
                  {msg.toolName && <span className="tool-badge">{msg.toolName}</span>}
                  {msg.actionLogLink && (
                    <a href={msg.actionLogLink} className="log-link" target="_blank" rel="noreferrer">
                      📋
                    </a>
                  )}
                </div>
              )}
              <p>{msg.content}</p>
            </div>

            {/* Rich cards */}
            {msg.cards && msg.cards.length > 0 && (
              <div className="message-cards">
                {msg.cards.map((card, idx) => (
                  <RichCardComponent key={idx} card={card} />
                ))}
              </div>
            )}

            {/* Timestamp */}
            <span className="message-time">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}

        {isLoading && (
          <div className="message message-assistant">
            <div className="message-content">
              <p className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form className="chat-input" onSubmit={handleSendMessage}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tell me about your household, or ask for meal plans..."
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/**
 * CSS styles for chat UI
 */
export const chatUIStyles = `
.chat-ui {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f5f5f5;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chat-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: #666;
}

.quick-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
  flex-wrap: wrap;
  justify-content: center;
}

.quick-actions button {
  padding: 10px 16px;
  border: 1px solid #ddd;
  background: white;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.quick-actions button:hover {
  background: #f0f0f0;
  border-color: #999;
}

.message {
  display: flex;
  flex-direction: column;
  max-width: 80%;
  padding: 12px 16px;
  border-radius: 8px;
  animation: slideIn 0.3s ease-in-out;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-user {
  align-self: flex-end;
  background: #007bff;
  color: white;
}

.message-assistant {
  align-self: flex-start;
  background: white;
  border: 1px solid #ddd;
}

.message-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
}

.tool-badge {
  background: #e3f2fd;
  color: #1976d2;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.log-link {
  color: #1976d2;
  text-decoration: none;
  cursor: pointer;
}

.log-link:hover {
  text-decoration: underline;
}

.message-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.card {
  background: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 12px;
  font-size: 14px;
}

.card h4 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
}

.card-approval {
  background: #fffbea;
  border-color: #ffc107;
}

.approval-summary {
  margin: 8px 0;
  font-size: 13px;
}

.approval-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.btn {
  padding: 6px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-approve {
  background: #4caf50;
  color: white;
  border-color: #4caf50;
}

.btn-approve:hover {
  background: #45a049;
}

.btn-decline {
  background: #f44336;
  color: white;
  border-color: #f44336;
}

.btn-decline:hover {
  background: #da190b;
}

.btn-edit {
  background: #2196f3;
  color: white;
  border-color: #2196f3;
}

.btn-edit:hover {
  background: #0b7dda;
}

.recipe-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #666;
  margin: 8px 0;
}

.recipe-meta span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.message-time {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
  align-self: flex-end;
}

.typing-indicator {
  display: flex;
  gap: 4px;
  margin: 0;
}

.typing-indicator span {
  display: inline-block;
  width: 8px;
  height: 8px;
  background: #999;
  border-radius: 50%;
  animation: bounce 1.4s infinite;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-10px);
  }
}

.chat-input {
  display: flex;
  gap: 8px;
  padding: 16px;
  background: white;
  border-top: 1px solid #ddd;
}

.chat-input input {
  flex: 1;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
}

.chat-input input:focus {
  border-color: #007bff;
  box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
}

.chat-input input:disabled {
  background: #f5f5f5;
  cursor: not-allowed;
}

.chat-input button {
  padding: 12px 24px;
  background: #007bff;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  transition: all 0.2s;
}

.chat-input button:hover:not(:disabled) {
  background: #0056b3;
}

.chat-input button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
`;
