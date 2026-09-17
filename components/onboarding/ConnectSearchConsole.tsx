"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { GscPermissionsDisclosure } from "./GscPermissionsDisclosure";
import { ConnectScenario, mockSearchConsoleService } from "@/lib/mock/search-console-service";
import { getApiBase } from "@/lib/data-contract/api-provider";
import { GoogleConnectionStatus } from "@/lib/mock/types";
import { resumeRoute } from "@/lib/mock/onboarding";
import { useSession } from "@/lib/mock/session-context";

type Phase = "idle" | "connecting" | "redirecting" | "returning" | GoogleConnectionStatus;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const inProgressCopy: Partial<Record<Phase, string>> = {
  connecting: "Connecting to Google…",
  redirecting: "Taking you to Google…",
  returning: "Returning to RENKO…",
};

const terminalCopy: Partial<Record<GoogleConnectionStatus, { tone: "danger" | "warning"; message: string }>> = {
  "permission-denied": {
    tone: "danger",
    message: "Google didn't grant RENKO access. RENKO needs read-only access to Search Console to find a recommendation.",
  },
  "permission-insufficient": {
    tone: "danger",
    message:
      "The Google account you used doesn't have full read access to this property in Search Console. Ask an owner to grant access, then try again.",
  },
  "account-mismatch": {
    tone: "danger",
    message: "You connected a different Google account than expected. Reconnect using the account that manages this property.",
  },
  expired: {
    tone: "warning",
    message: "Your Search Console connection has expired. Reconnect to keep RENKO's data current.",
  },
  "network-failure": {
    tone: "danger",
    message: "We couldn't reach Google. Check your connection and try again.",
  },
  "server-failure": {
    tone: "danger",
    message: "RENKO couldn't complete the connection right now. Try again in a moment.",
  },
};

function ConnectSearchConsoleInner() {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scenarioParam = searchParams.get("scenario") as ConnectScenario | null;
  // Backend OAuth return params (real mode only).
  const oauthStatus = searchParams.get("status");
  const oauthError = searchParams.get("error");

  const isReal = session.providerMode === "real";
  const alreadyConnected = session.onboarding.connection.status === "connected" && !scenarioParam && !oauthStatus;
  const [phase, setPhase] = useState<Phase>(alreadyConnected ? "connected" : "idle");
  const [running, setRunning] = useState(false);
  const [oauthReturnError, setOauthReturnError] = useState<string | null>(null);

  // Real mode: handle the backend OAuth callback redirect
  // (?status=connected or ?status=error&error=...). The backend is the
  // connection source of truth — refresh the session to pick it up.
  useEffect(() => {
    if (!isReal || !oauthStatus) return;
    if (oauthStatus === "connected") {
      setPhase("connected");
      void session.refreshSession();
    } else if (oauthStatus === "error") {
      setOauthReturnError(oauthError ?? "unknown_error");
      setPhase("server-failure");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReal, oauthStatus]);

  useEffect(() => {
    if (!scenarioParam || running) return;
    let cancelled = false;

    async function run(scenario: ConnectScenario) {
      setRunning(true);
      setPhase("connecting");
      await delay(300);
      if (cancelled) return;
      setPhase("redirecting");
      const result = await mockSearchConsoleService.connect(scenario);
      if (cancelled) return;
      setPhase("returning");
      await delay(250);
      if (cancelled) return;
      setPhase(result.status);
      session.setConnection(
        result.status === "connected"
          ? { status: "connected", googleAccountEmail: session.auth.user?.email ?? "you@example.com" }
          : { status: result.status }
      );
      setRunning(false);
    }

    void run(scenarioParam);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenarioParam]);

  function startConnect() {
    if (isReal) {
      // Real mode: enter the backend OAuth flow (302 to Google). The
      // workspace is validated server-side; the query value is a hint.
      const workspaceId = session.realWorkspace?.id;
      const base = getApiBase();
      window.location.href = workspaceId
        ? `${base}/auth/google/start?workspaceId=${encodeURIComponent(workspaceId)}`
        : `${base}/auth/google/start`;
      return;
    }
    router.replace(`${pathname}?scenario=success`);
  }

  const isBusy = phase === "connecting" || phase === "redirecting" || phase === "returning";
  const terminal = terminalCopy[phase as GoogleConnectionStatus];

  return (
    <div className="py-16 md:py-24">
      <Container>
        <div className="mx-auto w-full max-w-[520px]">
          <h1 className="font-serif text-h1 text-ink">Connect Google Search Console</h1>
          <p className="mt-3 text-body-lg text-ink-muted">
            RENKO uses your Search Console data to find the SEO change most worth making next.
          </p>
          <p className="mt-2 text-body text-ink-muted">
            RENKO needs read-only access to your Search Console data. RENKO does not make changes to your
            website.
          </p>

          <div className="mt-8 flex flex-col gap-4">
            {phase === "connected" && (
              <Alert tone="success">
                Search Console connected
                {session.onboarding.connection.googleAccountEmail
                  ? ` as ${session.onboarding.connection.googleAccountEmail}`
                  : ""}
                {!isReal && " (Mock connection — no real Google account was accessed.)"}
              </Alert>
            )}

            {oauthReturnError && (
              <Alert tone="danger">
                Google returned an error ({oauthReturnError}). Try connecting again, or continue with a different account.
              </Alert>
            )}

            {terminal && <Alert tone={terminal.tone}>{terminal.message}</Alert>}

            {isBusy && (
              <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-sm border border-line px-4 py-3 text-body text-ink-muted">
                <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 animate-spin text-ink-muted">
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.25" />
                  <path d="M18 10a8 8 0 0 0-8-8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
                {inProgressCopy[phase]}
              </div>
            )}

            {!isBusy && phase === "connected" && (
              <Button
                variant="primary"
                type="button"
                onClick={() => router.push(resumeRoute(session.onboarding))}
              >
                Continue
              </Button>
            )}

            {!isBusy && phase !== "connected" && (
              <Button variant="primary" type="button" onClick={startConnect}>
                {terminal ? "Try again" : "Connect with Google"}
              </Button>
            )}

            <GscPermissionsDisclosure />
          </div>
        </div>
      </Container>
    </div>
  );
}

export function ConnectSearchConsole() {
  return (
    <Suspense fallback={null}>
      <ConnectSearchConsoleInner />
    </Suspense>
  );
}
