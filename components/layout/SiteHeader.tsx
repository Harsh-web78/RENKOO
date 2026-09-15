import { Button } from "@/components/ui/Button";
import { primaryNav } from "@/lib/site-config";
import { Logo } from "./Logo";

export function SiteHeader() {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex h-16 max-w-page items-center justify-between px-6 md:px-8">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-8 md:flex">
          {primaryNav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-body text-ink-muted transition-colors duration-150 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Button href="/log-in" variant="ghost" size="sm">
            Log in
          </Button>
          <Button href="/sign-up" variant="primary" size="sm">
            Connect Search Console
          </Button>
        </div>

        {/* Mobile: zero-JS disclosure menu using native <details>. */}
        <details className="relative md:hidden">
          <summary
            aria-label="Open menu"
            className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-xs marker:content-none [&::-webkit-details-marker]:hidden"
          >
            <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 text-ink">
              <path
                d="M3 5.5h14M3 10h14M3 14.5h14"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </summary>

          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-sm border border-line bg-surface p-2 shadow-md">
            <nav aria-label="Mobile" className="flex flex-col">
              {primaryNav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-xs px-3 py-3 text-body text-ink hover:bg-surface-sunken"
                >
                  {item.label}
                </a>
              ))}
              <a href="/log-in" className="rounded-xs px-3 py-3 text-body text-ink hover:bg-surface-sunken">
                Log in
              </a>
            </nav>
            <div className="mt-2 border-t border-line pt-2">
              <Button href="/sign-up" variant="primary" size="sm" className="w-full">
                Connect Search Console
              </Button>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
