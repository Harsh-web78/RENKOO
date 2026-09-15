"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { PropertySwitcher } from "./PropertySwitcher";
import { resumeRoute } from "@/lib/mock/onboarding";
import { useSession } from "@/lib/mock/session-context";

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V9.5Z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
    </svg>
  );
}
function FixIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path d="M10 6.5v4l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <path d="M4 4v4h4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 8A6 6 0 1 1 5 13" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" fill="none" />
      <path
        d="M10 3v1.6M10 15.4V17M17 10h-1.6M4.6 10H3M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1M14.8 14.8l-1.1-1.1M6.3 6.3 5.2 5.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const navItems = [
  { href: "/home", label: "Home", icon: HomeIcon },
  { href: "/fixes", label: "Fixes", icon: FixIcon },
  { href: "/history", label: "History", icon: HistoryIcon },
];

function NavLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof HomeIcon; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xs px-3 py-2 text-body transition-colors duration-150 ${
        active ? "bg-brick-tint font-medium text-brick" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
      }`}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      {label}
    </Link>
  );
}

export function ProductShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const onboardingComplete = session.onboarding.connection.status === "connected" && Boolean(session.onboarding.propertyId);

  useEffect(() => {
    if (!session.hydrated) return;
    if (session.auth.status !== "authenticated") {
      router.replace("/log-in");
      return;
    }
    if (!onboardingComplete) {
      router.replace(resumeRoute(session.onboarding));
    }
  }, [session.hydrated, session.auth.status, onboardingComplete, session.onboarding, router]);

  useEffect(() => {
    if (session.hydrated && onboardingComplete && session.onboarding.propertyId) {
      session.ensurePropertyState(session.onboarding.propertyId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.hydrated, onboardingComplete, session.onboarding.propertyId]);

  if (!session.hydrated || session.auth.status !== "authenticated" || !onboardingComplete) {
    return <div className="min-h-screen bg-paper" />;
  }

  return (
    <div className="flex min-h-screen bg-paper">
      {/* Desktop sidebar */}
      <aside className="hidden w-[240px] flex-shrink-0 flex-col border-r border-line bg-paper md:flex">
        <div className="px-4 py-4">
          <Logo />
          <p className="mt-3 truncate text-caption text-ink-muted">{session.onboarding.workspaceName}</p>
          <div className="mt-3">
            <PropertySwitcher />
          </div>
        </div>

        <nav aria-label="Product" className="flex flex-1 flex-col gap-1 px-3">
          {navItems.map((item) => (
            <NavLink key={item.href} {...item} active={pathname.startsWith(item.href)} />
          ))}
        </nav>

        <div className="border-t border-line px-3 py-3">
          <NavLink href="/settings" label="Settings" icon={SettingsIcon} active={pathname.startsWith("/settings")} />
          <button
            type="button"
            onClick={() => {
              session.signOut();
              router.push("/");
            }}
            className="mt-1 flex w-full items-center gap-3 rounded-xs px-3 py-2 text-left text-body text-ink-muted hover:bg-surface-sunken hover:text-ink"
          >
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile top bar (logo + property switcher; nav lives in the bottom bar) */}
      <header className="fixed inset-x-0 top-0 z-30 flex items-center justify-between border-b border-line bg-paper px-4 py-3 md:hidden">
        <Logo />
        <div className="w-40">
          <PropertySwitcher />
        </div>
      </header>

      <div className="flex min-h-screen flex-1 flex-col pb-20 pt-16 md:pb-0 md:pt-0">
        <main className="flex-1">{children}</main>
      </div>

      {/* Mobile bottom nav */}
      <nav aria-label="Product" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-paper md:hidden">
        {[...navItems, { href: "/settings", label: "Settings", icon: SettingsIcon }].map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-caption ${
                active ? "font-medium text-brick" : "text-ink-muted"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
