import { getAll } from "@/lib/repo";
import { buildDashboard } from "@/lib/dashboard";
import { json, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireSession();
    const data = await getAll();
    return json(buildDashboard(data));
  });
}
