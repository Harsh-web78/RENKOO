"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Input } from "@/components/ui/Input";
import { PropertyCard } from "./PropertyCard";
import { mockSearchConsoleService } from "@/lib/mock/search-console-service";
import { SearchConsoleProperty } from "@/lib/mock/types";
import { resumeRoute } from "@/lib/mock/onboarding";
import { useSession } from "@/lib/mock/session-context";

type ListState = "loading" | "loaded" | "empty" | "error";

function SelectPropertyInner() {
  const session = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const scenario = (searchParams.get("scenario") as "success" | "empty" | "error" | null) ?? "success";

  const [state, setState] = useState<ListState>("loading");
  const [properties, setProperties] = useState<SearchConsoleProperty[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(session.onboarding.propertyId);

  const isReal = session.providerMode === "real";

  const load = useCallback(() => {
    setState("loading");
    mockSearchConsoleService
      .listProperties(scenario)
      .then((list) => {
        setProperties(list);
        setState(list.length === 0 ? "empty" : "loaded");
      })
      .catch(() => setState("error"));
  }, [scenario]);

  useEffect(() => {
    if (isReal) {
      // Real mode: the authorized property list comes from the backend
      // session context — never the mock service.
      if (!session.realSessionLoaded) {
        setState("loading");
        return;
      }
      if (session.realSessionError) {
        setState("error");
        return;
      }
      setProperties(session.realProperties);
      setState(session.realProperties.length === 0 ? "empty" : "loaded");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, isReal, session.realSessionLoaded]);

  const filtered = properties.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  function handleAnalyze() {
    if (!selectedId) return;
    session.selectProperty(selectedId);
    router.push(resumeRoute({ ...session.onboarding, propertyId: selectedId, analysisStatus: null, fix: null }));
  }

  return (
    <div className="py-16 md:py-24">
      <Container>
        <div className="mx-auto w-full max-w-[560px]">
          <h1 className="font-serif text-h1 text-ink">Select your website</h1>
          <p className="mt-3 text-body-lg text-ink-muted">
            Choose the Search Console property RENKO should analyze.
          </p>

          <div className="mt-8">
            {state === "loading" && (
              <div className="flex flex-col gap-3" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[76px] animate-pulse rounded-sm border border-line bg-surface-sunken" />
                ))}
              </div>
            )}

            {state === "error" && (
              <Alert
                tone="danger"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => {
                      if (isReal) void session.refreshSession();
                      else load();
                    }}
                  >
                    Try again
                  </Button>
                }
              >
                We couldn&apos;t load your Search Console properties.
              </Alert>
            )}

            {state === "empty" && (
              <div className="rounded-sm border border-line p-6">
                <p className="text-body-lg font-medium text-ink">No verified Search Console properties were found.</p>
                <p className="mt-2 text-body text-ink-muted">
                  RENKO needs access to at least one Search Console property before it can analyze your site.
                  Check your Search Console account, then try again.
                </p>
                <Button variant="secondary" type="button" className="mt-4" onClick={load}>
                  Recheck properties
                </Button>
              </div>
            )}

            {state === "loaded" && (
              <>
                {properties.length > 5 && (
                  <Input
                    label="Search properties"
                    placeholder="Start typing a property name"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="mb-4"
                  />
                )}

                {filtered.length === 0 ? (
                  <p className="rounded-sm border border-line px-4 py-6 text-center text-body text-ink-muted">
                    No properties match &ldquo;{query}&rdquo;.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {filtered.map((property) => (
                      <PropertyCard
                        key={property.id}
                        property={property}
                        selected={selectedId === property.id}
                        onSelect={setSelectedId}
                      />
                    ))}
                  </div>
                )}

                <Button
                  variant="primary"
                  type="button"
                  className="mt-6 w-full"
                  disabled={!selectedId}
                  onClick={handleAnalyze}
                >
                  Analyze this site
                </Button>
              </>
            )}
          </div>
        </div>
      </Container>
    </div>
  );
}

export function SelectProperty() {
  return (
    <Suspense fallback={null}>
      <SelectPropertyInner />
    </Suspense>
  );
}
