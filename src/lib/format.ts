export function formatPrice(price: number | null, currency: string | null) {
  if (price == null) return null;
  const code = currency ?? "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${code} ${price}`;
  }
}

/**
 * Marketplace titles are often SEO keyword dumps. Prefer the lead phrase
 * before pipe-like separators, then soft-cap length for compact UI.
 */
export function shortenProductTitle(title: string, maxLen = 72): string {
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (!cleaned) return title;

  const lead =
    cleaned
      .split(/\s*[|•·]\s*|\s+[–—]\s+|\s+I\s+(?=[a-z])/)
      .map((part) => part.trim())
      .find((part) => part.length >= 8) ?? cleaned;

  if (lead.length <= maxLen) return lead;
  const sliced = lead.slice(0, maxLen);
  const boundary = Math.max(
    sliced.lastIndexOf(" "),
    sliced.lastIndexOf(","),
  );
  const cut = boundary > maxLen * 0.55 ? sliced.slice(0, boundary) : sliced;
  return `${cut.trimEnd()}…`;
}
