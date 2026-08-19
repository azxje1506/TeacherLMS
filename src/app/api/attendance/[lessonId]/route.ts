/* One lesson's attendance register.
 *
 * GET  /api/attendance/:lessonId -> the register to render. Reading it writes no
 *      Attendance document: where none is stored, the roster comes back defaulted
 *      to Present and that default is never persisted.
 * POST /api/attendance/:lessonId -> save the visible register. Create and update
 *      are the same request and both answer 200 — a register is one thing per
 *      lesson, and whether the document already existed is not the client's
 *      business.
 *
 * No PUT (POST already replaces the submitted entries) and no DELETE (nothing in
 * the approved scope deletes a register, and a delete is precisely the operation
 * that could take stored entries for deleted students with it).
 */

import { getAttendanceRegister, saveAttendanceRegister } from "@/lib/attendance-service";
import { ATTENDANCE_ERROR } from "@/lib/attendance";
import { attendanceSaveSchema } from "@/lib/schemas";
import { json, error, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ lessonId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { lessonId } = await params;
    const res = await getAttendanceRegister(lessonId);
    if (!res.ok) return error(ATTENDANCE_ERROR[res.reason].message, ATTENDANCE_ERROR[res.reason].status);
    return json(res.register);
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return handle(async () => {
    await requireSession();
    const { lessonId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = attendanceSaveSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);
    // Eligibility and roster membership are re-checked inside the service, not
    // here: the UI's decision not to draw a button is not a rule, and a stale tab
    // must be refused by the same authority that drew the screen.
    const res = await saveAttendanceRegister(lessonId, parsed.data);
    if (!res.ok) return error(ATTENDANCE_ERROR[res.reason].message, ATTENDANCE_ERROR[res.reason].status);
    return json(res.register);
  });
}
