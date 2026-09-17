"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { mockAuthService } from "@/lib/mock/auth-service";
import { resumeRoute } from "@/lib/mock/onboarding";
import { useSession } from "@/lib/mock/session-context";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LogInForm() {
  const router = useRouter();
  const session = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForgotNote, setShowForgotNote] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!EMAIL_PATTERN.test(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(undefined);

    setSubmitting(true);
    if (session.providerMode === "real") {
      // Real mode: backend login → authenticated session → workspace
      // context rebuilt from /auth/me inside logInReal. No fake users.
      const result = await session.logInReal(email, password);
      setSubmitting(false);
      if (result.ok) {
        const workspaceName = result.workspaceName ?? session.onboarding.workspaceName;
        router.push(resumeRoute({ ...session.onboarding, workspaceName }));
        return;
      }
      setFormError(result.message ?? "We couldn't log you in. Try again.");
      return;
    }
    const result = await mockAuthService.logIn(email, password);
    setSubmitting(false);

    if (result.ok && result.user) {
      session.signIn(result.user);
      router.push(resumeRoute(session.onboarding));
      return;
    }

    setFormError(result.message ?? "We couldn't log you in. Try again.");
  }

  return (
    <AuthCard
      title="Welcome back."
      subtitle="See what RENKO thinks you should work on next."
      footer={
        <>
          New to RENKO?{" "}
          <a href="/sign-up" className="font-medium text-brick underline underline-offset-4">
            Create a workspace
          </a>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <GoogleAuthButton />

        <div className="flex items-center gap-3 text-caption text-ink-muted">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        {formError && <Alert tone="danger">{formError}</Alert>}

        <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
          <Input
            label="Work email"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={emailError}
            required
          />
          <div className="flex flex-col gap-1.5">
            <PasswordInput
              label="Password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowForgotNote(true)}
              className="self-start text-caption text-ink-muted underline underline-offset-4 hover:text-ink"
            >
              Forgot password?
            </button>
            {showForgotNote && (
              <p className="text-caption text-ink-muted" role="status">
                Password reset isn&apos;t available in this preview yet — contact support for now.
              </p>
            )}
          </div>
          <Button variant="primary" type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
