import { currencies, CurrencyCode } from "@/lib/pricing-config";

export function CurrencySelect({
  value,
  onChange,
}: {
  value: CurrencyCode;
  onChange: (currency: CurrencyCode) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-body text-ink-muted">
      Currency
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CurrencyCode)}
        className="rounded-xs border border-line bg-surface px-2 py-1.5 text-body text-ink focus-visible:outline-brick"
      >
        {Object.values(currencies).map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.label}
          </option>
        ))}
      </select>
    </label>
  );
}
