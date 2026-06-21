"use client";

import { LockKeyhole } from "lucide-react";
import { Button, Field, Input } from "@/components/ui";
import type { Translate } from "@/lib/i18n";
import type { QuestionMetrics } from "@/lib/types";

type StoaLandingProps = {
  questionMetrics: QuestionMetrics;
  loginName: string;
  loginPassword: string;
  authError: string;
  devLogin: null | { username: string; password: string };
  t: Translate;
  onLoginNameChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onLogin: (event: React.FormEvent) => void;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("de-DE").format(value);
}

export default function StoaLanding({
  questionMetrics,
  loginName,
  loginPassword,
  authError,
  devLogin,
  t,
  onLoginNameChange,
  onLoginPasswordChange,
  onLogin
}: StoaLandingProps) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-bg px-6 py-12 font-sans text-body text-text">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 12% 8%, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 42%), radial-gradient(circle at 88% 92%, color-mix(in srgb, var(--accent) 12%, transparent) 0%, transparent 38%)"
        }}
      />

      <div className="w-full max-w-sm">
        <div className="mb-8 grid gap-1">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-accent" />
            <strong className="text-h2 font-semibold">Stoa</strong>
          </div>
          <p className="m-0 text-body-sm text-text-muted">{t("login.subtitle")}</p>
        </div>

        <form
          className="grid gap-4 rounded border border-border bg-surface p-6"
          onSubmit={onLogin}
        >
          <Field htmlFor="login-name" label={t("login.username")}>
            <Input
              autoComplete="username"
              id="login-name"
              onChange={(event) => onLoginNameChange(event.target.value)}
              value={loginName}
            />
          </Field>
          <Field htmlFor="login-password" label={t("login.password")}>
            <Input
              autoComplete="current-password"
              id="login-password"
              onChange={(event) => onLoginPasswordChange(event.target.value)}
              type="password"
              value={loginPassword}
            />
          </Field>

          {authError ? (
            <p className="m-0 text-body-sm text-danger">{authError}</p>
          ) : null}
          {devLogin ? (
            <p className="m-0 text-label text-text-subtle">
              Lokale Entwicklung: {devLogin.username} / {devLogin.password}
            </p>
          ) : null}

          <Button className="w-full justify-center" type="submit" variant="primary">
            <LockKeyhole size={17} aria-hidden="true" />
            {t("common.signin")}
          </Button>
        </form>

        <p className="m-0 mt-6 text-center text-label text-text-subtle">
          {formatNumber(questionMetrics.questions)} Fragen · {questionMetrics.subjects}{" "}
          Fächer
        </p>
      </div>
    </main>
  );
}
