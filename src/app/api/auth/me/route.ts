import { getSession } from "@/lib/auth";
import { json, handle } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  return handle(async () => {
    const session = await getSession();
    if (!session) return json({ user: null }, 200);
    return json({ user: { email: session.email, name: session.name } });
  });
}
