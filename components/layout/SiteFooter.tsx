import { footerNav } from "@/lib/site-config";
import { Logo } from "./Logo";

function FooterColumn({ title, links }: { title: string; links: readonly { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-caption font-medium text-ink-muted">{title}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className="text-body text-ink-muted transition-colors duration-150 hover:text-ink">
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto max-w-page px-6 py-12 md:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Logo />
            <p className="mt-3 max-w-[220px] text-body text-ink-muted">
              Find the one SEO change worth making next.
            </p>
          </div>
          <FooterColumn title="Product" links={footerNav.product} />
          <FooterColumn title="Account" links={footerNav.account} />
          <FooterColumn title="Legal" links={footerNav.legal} />
        </div>
        <div className="mt-10 border-t border-line pt-6">
          <p className="text-caption text-ink-muted">© {new Date().getFullYear()} RENKO. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
