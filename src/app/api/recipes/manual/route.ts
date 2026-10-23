/** POST /api/recipes/manual: save a recipe the User typed in (session required). */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { ManualRecipeError, saveManualRecipe } from "@/lib/recipes/manual";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  try {
    const { householdId } = await requireUser();
    const id = await saveManualRecipe(getDb(), householdId, {
      title: typeof body.title === "string" ? body.title : "",
      ingredients: strs(body.ingredients),
      steps: strs(body.steps),
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : null,
      author: typeof body.author === "string" ? body.author : null,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (e instanceof ManualRecipeError) return NextResponse.json({ error: e.code, reasons: e.reasons }, { status: 422 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
