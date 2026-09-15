import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="RENKO home">
      <span className="block h-5 w-5 rounded-xs bg-brick" aria-hidden="true" />
      <span className="text-body-lg font-semibold text-ink">RENKO</span>
    </Link>
  );
}
