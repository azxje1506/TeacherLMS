import bcrypt from "bcryptjs";
import { dbConnect } from "@/lib/db";
import { User } from "@/lib/models";
import { loginSchema } from "@/lib/schemas";
import { createSessionCookie } from "@/lib/auth";
import { json, error, handle } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid input", 422);

    const { email, password, remember } = parsed.data;
    await dbConnect();
    const user = await User.findOne({ email: email.toLowerCase() });

if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
  return error("Invalid email or password", 401);
}

await createSessionCookie(
  { id: String(user._id), email: user.email, name: user.name },
  remember,
);

return json({
  user: {
    email: user.email,
    name: user.name,
  },
});
  });
}
