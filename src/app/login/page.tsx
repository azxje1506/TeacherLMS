"use client";

/* Login — ported verbatim from the design comp's Login screen (English Tutor
 * LMS.dc.html). Only behaviour is added: React Hook Form + Zod validation and a
 * POST to /api/auth/login which sets the HttpOnly session cookie. */

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@/lib/schemas";
import { useT } from "@/lib/settings-context";

function LoginInner() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, formState: { isSubmitting, errors } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "teacher@tutor.app", password: "demo1234", remember: true },
  });

  async function onSubmit(values: LoginInput) {
    setServerError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setServerError(data.error || "Sign in failed");
      return;
    }
    const from = params.get("from");
    router.replace(from && from.startsWith("/") ? from : "/dashboard");
    router.refresh();
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", height: 40, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 9,
    background: "var(--card)", color: "var(--fg)", fontSize: 14, fontFamily: "inherit", marginBottom: 16, outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1.05fr .95fr" }}>
      {/* Left — form */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
        <div style={{ width: "100%", maxWidth: 380, animation: "fadeUp .4s ease both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 36 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16 }}>E</div>
            <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-.01em" }}>English Tutor LMS</span>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", margin: "0 0 6px" }}>{t("Welcome back")}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 28px" }}>{t("Sign in to your teaching workspace.")}</p>

          <form onSubmit={handleSubmit(onSubmit)}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 7 }}>{t("Email")}</label>
            <input className="ring" type="email" autoComplete="username" style={inputStyle} {...register("email")} />

            <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 7 }}>{t("Password")}</label>
            <input className="ring" type="password" autoComplete="current-password" style={inputStyle} {...register("password")} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 22 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--fg-2)", cursor: "pointer" }}>
                <input type="checkbox" style={{ width: 15, height: 15, accentColor: "var(--accent)" }} {...register("remember")} /> {t("Remember me")}
              </label>
              <a href="#" style={{ fontSize: 13 }}>{t("Change password")}</a>
            </div>

            {(serverError || errors.email || errors.password) && (
              <p style={{ color: "var(--accent)", fontSize: 13, margin: "-8px 0 14px" }}>
                {serverError || errors.email?.message || errors.password?.message}
              </p>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={isSubmitting}
              style={{ width: "100%", height: 42, border: "none", borderRadius: 9, background: "var(--primary)", color: "var(--primary-fg)", fontSize: 14, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "opacity .15s" }}
            >
              {isSubmitting && <span style={{ width: 15, height: 15, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin .7s linear infinite", display: "inline-block" }} />}
              {t("Sign in")}
            </button>
          </form>

          <p style={{ textAlign: "center", color: "var(--muted-2)", fontSize: 12, marginTop: 22 }}>{t("Single-admin workspace · credentials pre-filled for demo")}</p>
        </div>
      </div>

      {/* Right — brand panel */}
      <div style={{ background: "var(--primary)", color: "var(--primary-fg)", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "48px 44px", position: "relative", overflow: "hidden" }}>
        <div style={{ fontSize: 13, opacity: 0.7, fontWeight: 500 }}>{t("Your digital notebook")}</div>
        <div>
          <div style={{ fontSize: 32, lineHeight: 1.25, fontWeight: 600, letterSpacing: "-.02em", maxWidth: 400 }}>{t("Manage every student, class and payment in one calm place.")}</div>
          <div style={{ display: "flex", gap: 28, marginTop: 34 }}>
            <div><div style={{ fontSize: 24, fontWeight: 600 }}>30s</div><div style={{ fontSize: 12, opacity: 0.6 }}>{t("to take attendance")}</div></div>
            <div><div style={{ fontSize: 24, fontWeight: 600 }}>1-click</div><div style={{ fontSize: 12, opacity: 0.6 }}>{t("monthly reports")}</div></div>
            <div><div style={{ fontSize: 24, fontWeight: 600 }}>Auto</div><div style={{ fontSize: 12, opacity: 0.6 }}>{t("tuition maths")}</div></div>
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.5 }}>English Tutor LMS · v1.0</div>
        <div style={{ position: "absolute", right: -80, top: -80, width: 280, height: 280, borderRadius: "50%", background: "rgba(255,255,255,.05)" }} />
        <div style={{ position: "absolute", right: 60, bottom: -120, width: 320, height: 320, borderRadius: "50%", background: "rgba(255,255,255,.04)" }} />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
