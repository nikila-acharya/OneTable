/**
 * WP-5.5 — REST API Layer: Agent coordination, approvals, actions
 * Endpoints for chat, approval cards, action logs, health insights
 * Uses Next.js API routes
 */

// src/app/api/agents/chat/route.ts
import { Coordinator } from "@/agent/coordinator";
import { SafetyGuardian } from "@/agent/safety-guardian";
import { AgentRuntime } from "@/agent/runtime";
import type { CoordinatorResponse } from "@/agent/coordinator";

export interface ChatRequest {
  householdId: string;
  userId: string;
  message: string;
}

export interface ChatResponse {
  success: boolean;
  response?: CoordinatorResponse;
  error?: string;
}

/**
 * POST /api/agents/chat — Send user message to Coordinator
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const { householdId, userId, message }: ChatRequest = await req.json();

    if (!householdId || !userId || !message) {
      return Response.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Initialize agents
    const runtime = new AgentRuntime(householdId, "household");
    const context = runtime.createContext(
      `run-${Date.now()}`,
      "conversational",
      "user_message",
      userId
    );

    const guardian = new SafetyGuardian(context);
    const coordinator = new Coordinator(context, runtime, guardian);

    // Process message
    const response = await coordinator.handleUserRequest(message);

    return Response.json({
      success: response.success,
      response,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// src/app/api/approvals/list/route.ts
export interface ApprovalsListRequest {
  householdId: string;
  status?: "pending" | "approved" | "declined" | "expired";
}

export interface ApprovalsListResponse {
  success: boolean;
  approvals?: Array<{
    id: string;
    summary: string;
    status: string;
    expiresAt: string;
    createdAt: string;
  }>;
  error?: string;
}

/**
 * GET /api/approvals/list — List approval cards
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const householdId = url.searchParams.get("householdId");
    const status = url.searchParams.get("status");

    if (!householdId) {
      return Response.json(
        { success: false, error: "Missing householdId" },
        { status: 400 }
      );
    }

    // In real implementation, would query database
    // For now, return mock structure
    return Response.json({
      success: true,
      approvals: [
        {
          id: "approval-001",
          summary: "Next week's meal plan",
          status: "pending",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
        },
      ],
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// src/app/api/approvals/approve/route.ts
export interface ApproveRequest {
  householdId: string;
  userId: string;
  cardId: string;
  editedProposal?: Record<string, unknown>;
}

/**
 * POST /api/approvals/approve — Approve an approval card
 */
export async function POST(req: Request, { params }: { params: { id: string } }): Promise<Response> {
  try {
    const { householdId, userId, cardId, editedProposal }: ApproveRequest = await req.json();

    if (!householdId || !userId || !cardId) {
      return Response.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // In real implementation, would:
    // 1. Load approval card from database
    // 2. Call approval.approve(cardId, userId, editedProposal)
    // 3. Create action log entry for approval
    // 4. Return success

    return Response.json({
      success: true,
      message: "Approval card approved successfully",
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// src/app/api/actions/list/route.ts
export interface ActionsListRequest {
  householdId: string;
  limit?: number;
  reversibleOnly?: boolean;
}

/**
 * GET /api/actions/list — List action log entries
 */
export async function GETActionsList(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const householdId = url.searchParams.get("householdId");
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const reversibleOnly = url.searchParams.get("reversibleOnly") === "true";

    if (!householdId) {
      return Response.json(
        { success: false, error: "Missing householdId" },
        { status: 400 }
      );
    }

    // In real implementation, would query action log from database
    return Response.json({
      success: true,
      actions: [
        {
          id: "action-001",
          tool: "draft_plan",
          permissionLevel: "P",
          inputsSummary: "Plan 2026-11-10 to 2026-11-16",
          resultSummary: "7 meals planned",
          timestamp: new Date().toISOString(),
          reversible: false,
        },
      ],
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// src/app/api/actions/undo/route.ts
export interface UndoRequest {
  householdId: string;
  userId: string;
  actionId: string;
}

/**
 * POST /api/actions/undo — Undo an action
 */
export async function POSTUndo(req: Request): Promise<Response> {
  try {
    const { householdId, userId, actionId }: UndoRequest = await req.json();

    if (!householdId || !userId || !actionId) {
      return Response.json(
        { success: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    // In real implementation, would:
    // 1. Load action from action log
    // 2. Call undo manager
    // 3. Restore previousState
    // 4. Log new undo action
    // 5. Return success

    return Response.json({
      success: true,
      message: "Action undone successfully",
      undoActionId: `undo-${Date.now()}`,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// src/app/api/household/get/route.ts
/**
 * GET /api/household/get — Get household profile
 */
export async function GETHousehold(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const householdId = url.searchParams.get("householdId");

    if (!householdId) {
      return Response.json(
        { success: false, error: "Missing householdId" },
        { status: 400 }
      );
    }

    // In real implementation, would query database
    return Response.json({
      success: true,
      household: {
        id: householdId,
        name: "Smith Family",
        members: [
          { id: "m1", name: "Ana", age: 35, activity: "light" },
          { id: "m2", name: "Leo", age: 11, activity: "moderate" },
        ],
        targetEnergyKcal: 2000,
        timezone: "America/New_York",
      },
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// src/app/api/insights/dashboard/route.ts
/**
 * GET /api/insights/dashboard — Get health insights dashboard
 */
export async function GETDashboard(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const householdId = url.searchParams.get("householdId");

    if (!householdId) {
      return Response.json(
        { success: false, error: "Missing householdId" },
        { status: 400 }
      );
    }

    // In real implementation, would aggregate data from multiple tables
    return Response.json({
      success: true,
      dashboard: {
        members: [
          {
            id: "m1",
            name: "Ana",
            age: 35,
            targetEnergy: 2000,
            completionRate: 75,
          },
        ],
        weeklyStats: {
          totalMeals: 21,
          avgCalories: 350,
          ownSourceCount: 5,
        },
        recentCheckIns: [
          { date: "2026-11-03", week: "2026-W45", activities: 4 },
        ],
      },
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * API Response wrapper type
 */
export interface APIResponse<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  meta?: {
    timestamp: string;
    version: string;
  };
}

/**
 * API Error response
 */
export interface APIError {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Helper function to create success response
 */
export function createSuccessResponse<T>(data: T): APIResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      version: "1.0",
    },
  };
}

/**
 * Helper function to create error response
 */
export function createErrorResponse(
  error: string,
  code?: string
): APIError {
  return {
    success: false,
    error,
    code,
  };
}
