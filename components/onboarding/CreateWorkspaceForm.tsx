"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Input } from "@/components/ui/Input";
import { resumeRoute } from "@/lib/mock/onboarding";
import { useSession } from "@/lib/mock/session-context";

export function CreateWorkspaceForm() {
  const session = useSession();
  const router = useRouter();
  const [name, setName] = useState(session.onboarding.workspaceName ?? "");
  const [error, setError] = useState<string | undefined>();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give your workspace a name to continue.");
      return;
    }
    session.setWorkspaceName(trimmed);
    router.push(resumeRoute({ ...session.onboarding, workspaceName: trimmed }));
  }

  return (
    <div className="py-16 md:py-24">
      <Container>
        <div className="mx-auto w-full max-w-[400px]">
          <h1 className="font-serif text-h1 text-ink">Create your RENKO workspace</h1>
          <p className="mt-3 text-body text-ink-muted">
            One name is all we need to get started — you can change it later.
          </p>

          <form className="mt-8 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
            <Input
              label="Workspace name"
              placeholder="Acme SEO"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={error}
              required
            />
            <Button variant="primary" type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </div>
      </Container>
    </div>
  );
}
