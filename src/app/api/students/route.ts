/* Students collection endpoint.
 *
 * GET  /api/students?q=&status=&grade=&sort=&dir=&page=&pageSize=
 *      -> { rows, total, page, pageSize, parents }
 *      sort ∈ name|grade|status|joined|school|parentName (default name), dir ∈ asc|desc.
 * POST /api/students  -> the created Student
 */

import { listStudents, createStudent } from "@/lib/students";
import { studentSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const p = new URL(req.url).searchParams;
    return json(
      await listStudents({
        q: p.get("q") ?? undefined,
        status: p.get("status") ?? undefined,
        grade: p.get("grade") ?? undefined,
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
    const parsed = studentSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    return json(await createStudent(parsed.data), 201);
  });
}
