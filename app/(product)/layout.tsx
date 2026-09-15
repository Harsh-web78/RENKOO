import { ProductShell } from "@/components/product/ProductShell";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <ProductShell>{children}</ProductShell>;
}
