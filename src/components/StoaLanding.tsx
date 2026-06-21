"use client";

import { LockKeyhole } from "lucide-react";
import { Button, Field, Input, cn } from "@/components/ui";
import type { Lang, Translate } from "@/lib/i18n";
import type { QuestionMetrics } from "@/lib/types";

type StoaLandingProps = {
  questionMetrics: QuestionMetrics;
  loginName: string;
  loginPassword: string;
  authError: string;
  devLogin: null | { username: string; password: string };
  lang: Lang;
  onLangChange: (lang: Lang) => void;
  t: Translate;
  onLoginNameChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onLogin: (event: React.FormEvent) => void;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default function StoaLanding({
  questionMetrics,
  loginName,
  loginPassword,
  authError,
  devLogin,
  lang,
  onLangChange,
  t,
  onLoginNameChange,
  onLoginPasswordChange,
  onLogin
}: StoaLandingProps) {
  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center bg-bg px-6 py-12 font-sans text-body text-text">
      <div
        aria-label="Language"
        className="absolute right-6 top-6 flex rounded border border-border bg-surface p-1"
        role="group"
      >
        {(["en", "de"] as const).map((option) => (
          <Button
            aria-pressed={lang === option}
            className={cn(
              "px-3 uppercase",
              lang === option && "bg-surface-muted text-text"
            )}
            key={option}
            onClick={() => onLangChange(option)}
            variant={lang === option ? "secondary" : "ghost"}
          >
            {option}
          </Button>
        ))}
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 grid gap-1">
          <strong className="text-h2 font-semibold">Stoa</strong>
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
              Local dev: {devLogin.username} / {devLogin.password}
            </p>
          ) : null}

          <Button className="w-full justify-center" type="submit" variant="primary">
            <LockKeyhole size={17} aria-hidden="true" />
            {t("common.signin")}
          </Button>
        </form>

        <p className="m-0 mt-6 text-center text-label text-text-subtle">
          {formatNumber(questionMetrics.questions)} questions · {questionMetrics.subjects}{" "}
          subjects
        </p>
      </div>
    </main>
  );
}
