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

export function SignUpForm() {
  const router = useRouter();
  const session = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [showLoginHint, setShowLoginHint] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setShowLoginHint(false);

    let hasError = false;
    if (!EMAIL_PATTERN.test(email)) {
      setEmailError("Enter a valid email address.");
      hasError = true;
    } else {
      setEmailError(undefined);
    }
    if (password.length < 8) {
      setPasswordError("The password must contain at least 8 characters.");
      hasError = true;
    } else {
      setPasswordError(undefined);
    }
    if (hasError) return;

    setSubmitting(true);
    if (session.providerMode === "real") {
      // Real mode: backend signup creates the user + workspace and starts
      // the authenticated session. No fake frontend users/workspaces.
      const result = await session.signUpReal(email, password);
      setSubmitting(false);
      if (result.ok) {
        const workspaceName = result.workspaceName ?? session.onboarding.workspaceName;
        router.push(resumeRoute({ ...session.onboarding, workspaceName }));
        return;
      }
      setFormError(result.message ?? "We couldn't create your account. Try again.");
      if (result.errorCode === "email-exists") setShowLoginHint(true);
      return;
    }
    const result = await mockAuthService.signUp(email, password);
    setSubmitting(false);

    if (result.ok && result.user) {
      session.signIn(result.user);
      router.push(resumeRoute(session.onboarding));
      return;
    }

    setFormError(result.message ?? "We couldn't create your account. Try again.");
    if (result.errorCode === "email-exists") setShowLoginHint(true);
  }

  return (
    <AuthCard
      title="Create your RENKO workspace"
      subtitle="RENKO finds the one SEO change worth making next."
      footer={
        <>
          Already have an account?{" "}
          <a href="/log-in" className="font-medium text-brick underline underline-offset-4">
            Log in
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

        {formError && (
          <Alert tone="danger">
            {formError}
            {showLoginHint && (
              <>
                {" "}
                <a href="/log-in" className="font-medium underline underline-offset-4">
                  Log in
                </a>
              </>
            )}
          </Alert>
        )}

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
          <PasswordInput
            label="Password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={passwordError}
            helperText="Must be at least 8 characters."
            required
          />
          <Button variant="primary" type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
