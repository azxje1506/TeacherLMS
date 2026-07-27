/* Single parent endpoint.
 *
 * GET    /api/parents/:id -> the Parent
 * PATCH  /api/parents/:id -> the updated Parent
 * DELETE /api/parents/:id -> { ok: true }. Linked students are unassigned
 *        (never deleted); see deleteParent in lib/parents.
 */

import { getParent, updateParent, deleteParent } from "@/lib/parents";
import { parentSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const found = await getParent(id);
    if (!found) return error("Parent not found", 404);
    return json(found);
  });
}

export async function PATCH(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const parsed = parentSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    const updated = await updateParent(id, parsed.data);
    if (!updated) return error("Parent not found", 404);
    return json(updated);
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { id } = await params;
    const ok = await deleteParent(id);
    if (!ok) return error("Parent not found", 404);
    return json({ ok: true });
  });
}
