/**
 * WP-5.6 — Frontend Hooks & State Management
 * Custom React hooks for chat, approvals, actions, insights
 * Global state management with React Context
 */

import { useCallback, useReducer, useContext, createContext } from "react";
import type { ChatMessage } from "@/components/ChatUI";
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
  approvals: Array<{
    id: string;
    summary: string;
    status: string;
    expiresAt: string;
  }>;
  actions: Array<{
    id: string;
    tool: string;
    timestamp: string;
    reversible: boolean;
  }>;
}

export type AppAction =
  | { type: "SET_HOUSEHOLD"; payload: string }
  | { type: "SET_USER"; payload: string }
  | { type: "ADD_MESSAGE"; payload: ChatMessage }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "ADD_APPROVAL"; payload: (typeof AppState.approvals)[0] }
  | { type: "UPDATE_APPROVAL"; payload: { id: string; status: string } }
  | { type: "ADD_ACTION"; payload: (typeof AppState.actions)[0] }
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
        const response = await fetch("/api/agents/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            householdId: state.householdId,
            userId: state.userId,
            message,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.success && data.response) {
          // Add assistant message
          const assistantMsg: ChatMessage = {
            id: `msg-${Date.now()}-resp`,
            role: "assistant",
            content: data.response.message,
            timestamp: new Date().toISOString(),
            cards: data.response.cards,
          };
          dispatch({ type: "ADD_MESSAGE", payload: assistantMsg });

          // Add approval card if present
          if (data.response.approvalCard) {
            dispatch({
              type: "ADD_APPROVAL",
              payload: {
                id: data.response.approvalCard.id,
                summary: data.response.approvalCard.summary,
                status: "pending",
                expiresAt: data.response.approvalCard.expiresAt,
              },
            });
          }
        } else {
          throw new Error(data.error || "Unknown error");
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

  const approveCard = useCallback(
    async (cardId: string, editedProposal?: Record<string, unknown>) => {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_ERROR", payload: null });

      try {
        const response = await fetch("/api/approvals/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            householdId: state.householdId,
            userId: state.userId,
            cardId,
            editedProposal,
          }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        if (data.success) {
          dispatch({
            type: "UPDATE_APPROVAL",
            payload: { id: cardId, status: "approved" },
          });
        } else {
          throw new Error(data.error);
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

  const declineCard = useCallback(
    async (cardId: string, reason?: string) => {
      dispatch({ type: "UPDATE_APPROVAL", payload: { id: cardId, status: "declined" } });
    },
    [dispatch]
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
        const response = await fetch("/api/actions/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            householdId: state.householdId,
            userId: state.userId,
            actionId,
          }),
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        if (data.success) {
          dispatch({ type: "UNDO_ACTION", payload: actionId });
        } else {
          throw new Error(data.error);
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
    actions: state.actions,
    undoAction,
  };
}

/**
 * useInsights hook
 */
export function useInsights() {
  const { state } = useAppState();
  const [insights, setInsights] = React.useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = React.useState(false);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/insights/dashboard?householdId=${state.householdId}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (data.success) {
        setInsights(data.dashboard);
      }
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
