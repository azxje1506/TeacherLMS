import { getCounts } from "@/lib/repo";
import { json, handle, requireSession } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    await requireSession();
    return json(await getCounts());
  });
}
