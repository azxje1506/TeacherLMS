/* Classes collection endpoint.
 *
 * GET  /api/classes?q=&status=&sort=&dir=&page=&pageSize=
 *      -> { rows, total, page, pageSize }
 *      sort ∈ name|type|status|fee (default name), dir ∈ asc|desc.
 * POST /api/classes  -> the created Class
 */

import { listClasses, createClass } from "@/lib/classes";
import { classSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const p = new URL(req.url).searchParams;
    return json(
      await listClasses({
        q: p.get("q") ?? undefined,
        status: p.get("status") ?? undefined,
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
    const parsed = classSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    return json(await createClass(parsed.data), 201);
  });
}
