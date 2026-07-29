/* Schedule availability endpoint — read-only.
 *
 * GET /api/classes/availability?days=1,3,5&start=18:00&duration=90&excludeId=
 *     -> { conflicts, suggestions }
 *
 * Backs the create/edit drawer's "Suggested available times" and its inline
 * conflict warning. It only reports what the existing overlap rule would say;
 * the authoritative check still runs on POST / PATCH /api/classes.
 */

import { scheduleAvailability } from "@/lib/classes";
import { json, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return handle(async () => {
    await requireSession();
    const p = new URL(req.url).searchParams;
    return json(
      await scheduleAvailability({
        days: p.get("days") ?? undefined,
        start: p.get("start") ?? undefined,
        duration: p.get("duration") ?? undefined,
        excludeId: p.get("excludeId") ?? undefined,
      })
    );
  });
}
