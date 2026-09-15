import { HTMLAttributes } from "react";

type ContainerWidth = "content" | "page";

interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  width?: ContainerWidth;
}

/**
 * Page-level content never stretches full width, even on large screens —
 * RENKO's job is focus, not filling the viewport. `content` (720px) is the
 * default reading width; `page` (1120px) is used only for wider layout
 * moments like the pricing card pair.
 */
export function Container({ width = "content", className = "", children, ...props }: ContainerProps) {
  const maxWidth = width === "page" ? "max-w-page" : "max-w-content";
  return (
    <div className={`mx-auto w-full ${maxWidth} px-6 md:px-8 ${className}`} {...props}>
      {children}
    </div>
  );
}
