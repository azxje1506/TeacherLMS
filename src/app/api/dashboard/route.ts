import { getAll } from "@/lib/repo";
import { advanceLessonLifecycle } from "@/lib/lifecycle";
import { buildDashboard } from "@/lib/dashboard";
import { json, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireSession();
    // THE LIFECYCLE MUST RUN HERE, NOT INSIDE `getAll()`.
    //
    // This route is the only path to `computeRevenue` / `teachingHours` /
    // `attendanceRate` (via buildDashboard), and unlike `listLessons` it does not
    // pass through `ensureRegularLessons`. Without this call the dashboard would
    // report figures derived from lessons whose dates have passed but whose status
    // was never resolved — permanently zero revenue, exactly the §9.2 defect.
    //
    // `repo.getAll()` stays a pure read: it is a generic collection dump used as a
    // read model, and burying a write in it would make every future caller mutate
    // the database as a side effect of asking a question. The call site is explicit
    // here for the same reason `listLessons` calls its own reconcilers explicitly.
    await advanceLessonLifecycle();
    const data = await getAll();
    return json(buildDashboard(data));
  });
}
