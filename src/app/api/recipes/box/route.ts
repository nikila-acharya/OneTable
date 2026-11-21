/** GET /api/recipes/box: this household's recipe box (session required). */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRecipeBox } from "@/lib/recipes/box";
import { serverError } from "../../../../lib/api/errors";

export async function GET() {
  try {
    const { householdId } = await requireUser();
    return NextResponse.json(await getRecipeBox(getDb(), householdId));
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    return serverError("api/recipes/box", e);
  }
}
