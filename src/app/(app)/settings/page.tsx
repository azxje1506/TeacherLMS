/* /settings — the server half of the Settings screen.
 *
 * IT EXISTS ONLY TO CARRY THE IDENTITY ACROSS. The controls need `useSettings()`
 * and are therefore a client component, but the Workspace card names the signed-in
 * teacher — and a browser must not go and ask who that is when the server already
 * knows. So this reads the session with the SAME helper the app layout uses and
 * hands the client exactly two read-only strings. No `/api/auth/me` call, no
 * second auth implementation, no session in React state.
 *
 * THE LAYOUT IS STILL THE GUARD. `(app)/layout.tsx` redirects an unauthenticated
 * visitor before this ever renders, so the fallbacks below are the type system's
 * business rather than a second access check — this file authorises nothing.
 */

import { getSession } from "@/lib/auth";
import { SettingsScreen } from "@/components/settings/settings-screen";

export default async function Page() {
  const session = await getSession();
  return <SettingsScreen account={{ name: session?.name ?? "", email: session?.email ?? "" }} />;
}
