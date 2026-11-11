/**
 * WP-5.6 — Frontend Hooks & State Management
 * Custom React hooks for chat, approvals, actions, insights
 * Global state management with React Context
 */

import React, { useCallback, useReducer, useContext, createContext, useState } from "react";
import type { ChatMessage } from "@/components/ChatUI";
import type { InsightMember } from "@/lib/agents/persistence";
import type { CoordinatorResponse } from "@/agent/coordinator";

/**
 * App state context
 */
export interface AppState {
  householdId: string;
  userId: string;
  isLoading: boolean;
  error: string | null;
  messages: ChatMessage[];
  approvals: ApprovalEntry[];
  actions: ActionEntry[];
}

export interface ApprovalEntry {
  id: string;
  summary: string;
  status: string;
  expiresAt: string;
}

export interface ActionEntry {
  id: string;
  tool: string;
  timestamp: string;
  reversible: boolean;
}

export type AppAction =
  | { type: "SET_HOUSEHOLD"; payload: string }
  | { type: "SET_USER"; payload: string }
  | { type: "ADD_MESSAGE"; payload: ChatMessage }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "ADD_APPROVAL"; payload: ApprovalEntry }
  | { type: "UPDATE_APPROVAL"; payload: { id: string; status: string } }
  | { type: "ADD_ACTION"; payload: ActionEntry }
  | { type: "UNDO_ACTION"; payload: string };

const initialState: AppState = {
  householdId: "",
  userId: "",
  isLoading: false,
  error: null,
  messages: [],
  approvals: [],
  actions: [],
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_HOUSEHOLD":
      return { ...state, householdId: action.payload };
    case "SET_USER":
      return { ...state, userId: action.payload };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload };
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.payload] };
    case "ADD_APPROVAL":
      return { ...state, approvals: [...state.approvals, action.payload] };
    case "UPDATE_APPROVAL":
      return {
        ...state,
        approvals: state.approvals.map((a) =>
          a.id === action.payload.id ? { ...a, status: action.payload.status } : a
        ),
      };
    case "ADD_ACTION":
      return { ...state, actions: [...state.actions, action.payload] };
    case "UNDO_ACTION":
      return {
        ...state,
        actions: state.actions.filter((a) => a.id !== action.payload),
      };
    default:
      return state;
  }
}

// Create context
const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | undefined>(undefined);

/**
 * useAppState hook
 */
export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}

/**
 * useChat hook
 */
export function useChat() {
  const { state, dispatch } = useAppState();

  const sendMessage = useCallback(
    async (message: string) => {
      // Add user message
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user",
        content: message,
        timestamp: new Date().toISOString(),
      };
      dispatch({ type: "ADD_MESSAGE", payload: userMsg });

      // Send to API
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        // The route derives household + user from the session, so the body is
        // just the message: a client cannot address another household.
        const response = await fetch("/api/agents/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        const data = (await response.json()) as {
          message: string;
          cards?: ChatMessage["cards"];
          approvalId?: string | null;
        };

        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            id: `msg-${Date.now()}-resp`,
            role: "assistant",
            content: data.message,
            timestamp: new Date().toISOString(),
            cards: data.cards,
          },
        });

        // approvalId is the DB row id; expiresAt is not returned by the route, so
        // the inbox list endpoint remains the source of truth for the full card.
        if (data.approvalId) {
          dispatch({
            type: "ADD_APPROVAL",
            payload: {
              id: data.approvalId,
              summary: data.message,
              status: "pending",
              expiresAt: "",
            },
          });
        }
      } catch (error) {
        dispatch({
          type: "SET_ERROR",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [state.householdId, state.userId, dispatch]
  );

  return {
    messages: state.messages,
    isLoading: state.isLoading,
    error: state.error,
    sendMessage,
  };
}

/**
 * useApprovals hook
 */
export function useApprovals() {
  const { state, dispatch } = useAppState();

  /**
   * Records the decision server-side, then mirrors it locally. A refusal to
   * reach the server is surfaced as an error and the card is left untouched:
   * an optimistic "declined" that never persisted was a real bug here, because
   * the row would still be pending on the next load.
   */
  const postDecision = useCallback(
    async (cardId: string, decision: "approve" | "decline") => {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });
      try {
        const response = await fetch(`/api/approvals/${encodeURIComponent(cardId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          status?: string;
        };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);

        dispatch({
          type: "UPDATE_APPROVAL",
          payload: { id: cardId, status: data.status ?? decision + "d" },
        });
      } catch (error) {
        dispatch({
          type: "SET_ERROR",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [dispatch]
  );

  // Edited proposals are not applied by the decision route (it records the
  // decision only), so this hook deliberately takes no edit payload.
  const approveCard = useCallback(
    (cardId: string) => postDecision(cardId, "approve"),
    [postDecision],
  );

  const declineCard = useCallback(
    (cardId: string) => postDecision(cardId, "decline"),
    [postDecision],
  );

  return {
    approvals: state.approvals,
    approveCard,
    declineCard,
  };
}

/**
 * useActions hook
 */
export function useActions() {
  const { state, dispatch } = useAppState();

  const undoAction = useCallback(
    async (actionId: string) => {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const response = await fetch(`/api/actions/${encodeURIComponent(actionId)}/undo`, {
          method: "POST",
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);

        dispatch({ type: "UNDO_ACTION", payload: actionId });
      } catch (error) {
        dispatch({
          type: "SET_ERROR",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        dispatch({ type: "SET_LOADING", payload: false });
      }
    },
    [state.householdId, state.userId, dispatch]
  );

  return {
    actions: state.actions,
    undoAction,
  };
}

/**
 * useInsights hook
 */
export function useInsights() {
  const { state } = useAppState();
  const [insights, setInsights] = React.useState<InsightMember[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/insights");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { members?: InsightMember[] };
      setInsights(data.members ?? []);
    } catch (error) {
      console.error("Failed to load insights:", error);
    } finally {
      setLoading(false);
    }
  }, [state.householdId]);

  return {
    insights,
    loading,
    loadDashboard,
  };
}

/**
 * App Provider Component
 */
export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}
