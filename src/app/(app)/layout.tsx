import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getActiveNotifications } from "@/lib/notifications-server";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  /* THE NOTIFICATION BOUNDARY, and the reason there is no `/api/notifications`.
   *
   * This layout already runs on the server for every authenticated route and
   * already hands `AppShell` server-owned values. Notifications are derived from
   * Billing, Lesson and Review — data this process can already read — so they are
   * computed here and passed down exactly as `user` is. A route would have been
   * an endpoint whose only job was to hand the client state the server already
   * had, which is the thing the contract names and refuses.
   *
   * AFTER the session check, so an unauthenticated request redirects without
   * touching the database. Device-local read and dismiss state is not resolved
   * here and cannot be: it lives in the browser, and the panel applies it. */
  const notifications = await getActiveNotifications();

  return (
    <AppShell user={{ name: session.name, email: session.email }} notifications={notifications}>
      {children}
    </AppShell>
  );
}
