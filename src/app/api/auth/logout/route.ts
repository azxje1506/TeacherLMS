import { clearSessionCookie } from "@/lib/auth";
import { json, handle } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  return handle(async () => {
    await clearSessionCookie();
    return json({ ok: true });
  });
}
