/* Classroom suggestions.
 *
 * GET /api/classes/classrooms -> { classrooms: string[] }
 *
 * Read-only. The list is derived from the classrooms existing classes already
 * use (normalized + de-duplicated), so the drawer can autocomplete without a
 * Room entity. Typing a brand-new name stays valid — this only suggests.
 */

import { listClassrooms } from "@/lib/classes";
import { json, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireSession();
    return json({ classrooms: await listClassrooms() });
  });
}
