"use client";

/* AppShell — the authenticated frame (sidebar + header + scrolling content),
 * ported from the design comp's "APP SHELL" section. Holds the sidebar
 * collapsed state and the logout flow; nav badge counts come from the API. */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "./sidebar";
import { Header } from "./header";

async function fetchCounts(): Promise<{ students: number; classes: number }> {
  const res = await fetch("/api/meta/counts");
  if (!res.ok) throw new Error("counts");
  return res.json();
}

export function AppShell({ user, children }: { user: { name: string; email: string }; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();

  const { data: counts } = useQuery({ queryKey: ["meta", "counts"], queryFn: fetchCounts });

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar collapsed={collapsed} counts={{ students: counts?.students ?? 0, classes: counts?.classes ?? 0 }} onLogout={onLogout} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header onToggleSidebar={() => setCollapsed((c) => !c)} user={user} />
        <main className="app-main" style={{ flex: 1, width: "100%", maxWidth: 1400, margin: "0 auto", padding: "28px 32px 48px" }}>
          {children}
        </main>
      </div>
    </div>
  );
}
