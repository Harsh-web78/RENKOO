export function GscPermissionsDisclosure() {
  return (
    <details className="group rounded-sm border border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-body font-medium text-ink marker:content-none [&::-webkit-details-marker]:hidden">
        What access does RENKO need?
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="h-5 w-5 flex-shrink-0 text-ink-muted transition-transform duration-200 group-open:rotate-180"
        >
          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </summary>
      <div className="grid gap-6 border-t border-line px-4 py-4 sm:grid-cols-2">
        <div>
          <p className="text-caption font-medium text-ink-muted">What RENKO can read</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-body text-ink">
            <li>Search performance data</li>
            <li>Pages</li>
            <li>Queries</li>
            <li>Clicks, impressions, CTR</li>
            <li>Average position</li>
          </ul>
        </div>
        <div>
          <p className="text-caption font-medium text-ink-muted">What RENKO cannot do</p>
          <ul className="mt-2 flex flex-col gap-1.5 text-body text-ink">
            <li>Change your website</li>
            <li>Publish content</li>
            <li>Modify Search Console settings</li>
            <li>Delete Search Console data</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
