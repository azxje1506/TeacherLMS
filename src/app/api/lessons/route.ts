/* Lessons collection endpoint.
 *
 * GET /api/lessons?q=&status=&type=&classId=&from=&to=&sort=&dir=&page=&pageSize=
 *     -> { rows, total, page, pageSize }. Reconciles Regular lessons first.
 *
 * There is no generic POST here by design: Regular lessons are generated
 * automatically, and the only ad-hoc creators are POST /api/lessons/extra and
 * POST /api/lessons/:id/makeup.
 */

import { listLessons } from "@/lib/lessons";
import { json, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const p = new URL(req.url).searchParams;
    return json(
      await listLessons({
        q: p.get("q") ?? undefined,
        status: p.get("status") ?? undefined,
        type: p.get("type") ?? undefined,
        classId: p.get("classId") ?? undefined,
        from: p.get("from") ?? undefined,
        to: p.get("to") ?? undefined,
        sort: p.get("sort") ?? undefined,
        dir: p.get("dir") ?? undefined,
        page: p.get("page") ?? undefined,
        pageSize: p.get("pageSize") ?? undefined,
      })
    );
  });
}
