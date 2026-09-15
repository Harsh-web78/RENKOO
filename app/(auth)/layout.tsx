import { MinimalHeader } from "@/components/layout/MinimalHeader";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MinimalHeader />
      <main className="flex-1">{children}</main>
    </>
  );
}
