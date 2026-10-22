/** GET one recipe for review; POST {action:"confirm",field} or {action:"edit",title?,ingredients?,steps?}. Session required. */
import { NextResponse } from "next/server";
import { requireUser, AuthenticationError } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { confirmField, editFields, getForReview, RecipeNotFoundError } from "@/lib/recipes/review";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(e: unknown) {
  if (e instanceof AuthenticationError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (e instanceof RecipeNotFoundError) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ error: "server_error" }, { status: 500 });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { householdId } = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(await getForReview(getDb(), householdId, id));
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  try {
    const { householdId } = await requireUser();
    const { id } = await ctx.params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const db = getDb();
    if (body.action === "confirm" && typeof body.field === "string") {
      return NextResponse.json(await confirmField(db, householdId, id, body.field));
    }
    if (body.action === "edit") {
      const strs = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined);
      return NextResponse.json(
        await editFields(db, householdId, id, {
          title: typeof body.title === "string" ? body.title : undefined,
          ingredients: strs(body.ingredients),
          steps: strs(body.steps),
        }),
      );
    }
    return NextResponse.json({ error: "invalid_review_action" }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
