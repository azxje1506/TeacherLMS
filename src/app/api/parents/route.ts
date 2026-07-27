/* Parents collection endpoint.
 *
 * GET  /api/parents?q=&sort=&dir=&page=&pageSize=
 *      -> { rows, total, page, pageSize }  (each row carries childCount)
 *      sort ∈ name|relationship (default name), dir ∈ asc|desc.
 * POST /api/parents  -> the created Parent
 */

import { listParents, createParent } from "@/lib/parents";
import { parentSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const p = new URL(req.url).searchParams;
    return json(
      await listParents({
        q: p.get("q") ?? undefined,
        sort: p.get("sort") ?? undefined,
        dir: p.get("dir") ?? undefined,
        page: p.get("page") ?? undefined,
        pageSize: p.get("pageSize") ?? undefined,
      })
    );
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    await requireSession();
    const body = await req.json().catch(() => null);
    const parsed = parentSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    return json(await createParent(parsed.data), 201);
  });
}
