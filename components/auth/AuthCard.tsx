import { ReactNode } from "react";
import { Container } from "@/components/ui/Container";

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="py-16 md:py-24">
      <Container>
        <div className="mx-auto w-full max-w-[400px]">
          <h1 className="font-serif text-h1 text-ink">{title}</h1>
          <p className="mt-3 text-body text-ink-muted">{subtitle}</p>

          <div className="mt-8">{children}</div>

          {footer && <div className="mt-6 text-center text-body text-ink-muted">{footer}</div>}
        </div>
      </Container>
    </div>
  );
}
