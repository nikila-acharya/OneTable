/**
 * POST /api/signup {email, password, householdName?} -> 201 {householdId}
 * Creates the household and its single User. Sign-in is a separate step
 * (credentials provider). Wrong input: 422 with issues, nothing stored.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { signUpHousehold, EmailTakenError, SignupRejectedError } from "@/lib/signup/service";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const { householdId } = await signUpHousehold(getDb(), (body ?? {}) as { email: unknown; password: unknown; householdName?: unknown });
    return NextResponse.json({ householdId }, { status: 201 });
  } catch (e) {
    if (e instanceof SignupRejectedError) return NextResponse.json({ error: e.code, issues: e.issues }, { status: 422 });
    if (e instanceof EmailTakenError) return NextResponse.json({ error: e.code }, { status: 409 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
