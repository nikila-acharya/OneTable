/**
 * GET  /api/consent            -> effective state per data type
 * POST /api/consent {dataType, granted} -> grant or withdraw (household session)
 * PV01: an unauthenticated call is 401; a bad data type is 400; nothing is
 * stored for a bad request.
 */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { grantConsent, withdrawConsent } from "@/lib/consent/service";
import { effectiveStates } from "@/lib/consent/store";
import { isConsentDataType } from "@/lib/consent/types";
import { currentPolicyVersion } from "@/lib/consent/policy";


function errorResponse(e: unknown) {
  if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}

export async function GET() {
  try {
    const { householdId } = await requireUser();
    const states = await effectiveStates(getDb(), householdId);
    return NextResponse.json({ policyVersion: currentPolicyVersion(), states });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const { dataType, granted } = (body ?? {}) as { dataType?: unknown; granted?: unknown };
  if (!isConsentDataType(dataType) || typeof granted !== "boolean") {
    return NextResponse.json({ error: "invalid_consent_request" }, { status: 400 });
  }
  try {
    const { householdId } = await requireUser();
    if (granted) await grantConsent(getDb(), householdId, dataType);
    else await withdrawConsent(getDb(), householdId, dataType);
    const states = await effectiveStates(getDb(), householdId);
    return NextResponse.json({ policyVersion: currentPolicyVersion(), states });
  } catch (e) {
    return errorResponse(e);
  }
}
