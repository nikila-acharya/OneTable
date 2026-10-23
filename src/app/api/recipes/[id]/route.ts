/** GET /api/recipes/[id]: one recipe from the household's box (session required). */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRecipeDetail } from "@/lib/recipes/detail";
import { RecipeNotFoundError } from "@/lib/recipes/review";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { householdId } = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(await getRecipeDetail(getDb(), householdId, id));
  } catch (e) {
    if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (e instanceof RecipeNotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
