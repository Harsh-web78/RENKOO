"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * This button is authentication only — separate from the later "Connect
 * with Google" action in onboarding, which authorizes Search Console
 * access. Clicking never simulates a successful OAuth result; it just
 * says plainly that this path isn't wired up yet.
 */
export function GoogleAuthButton() {
  const [clicked, setClicked] = useState(false);

  return (
    <div>
      <Button variant="secondary" type="button" className="w-full" onClick={() => setClicked(true)}>
        Continue with Google
      </Button>
      {clicked && (
        <p className="mt-2 text-caption text-ink-muted" role="status">
          Google sign-in isn&apos;t connected in this preview yet — use email below.
        </p>
      )}
    </div>
  );
}
