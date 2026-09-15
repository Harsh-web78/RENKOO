export interface AccordionItem {
  question: string;
  answer: string;
}

/**
 * Uses native <details>/<summary> rather than a client-side accordion.
 * This gives correct keyboard behavior, screen-reader semantics, and
 * open/close state for free, with zero JavaScript shipped to the browser.
 */
export function Accordion({ items }: { items: AccordionItem[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.question} className="group py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-body-lg font-medium text-ink marker:content-none [&::-webkit-details-marker]:hidden">
            {item.question}
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-5 w-5 flex-shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
            >
              <path
                d="M5 7.5L10 12.5L15 7.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </summary>
          <p className="mt-3 max-w-content text-body text-ink-muted">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
