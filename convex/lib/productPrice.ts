/** Inclusive floor for plausible product prices (USD-style amounts). */
export const MIN_PRODUCT_PRICE = 5;

/** Inclusive ceiling — rejects absurd scrape noise. */
export const MAX_PRODUCT_PRICE = 100_000;

/**
 * Drop implausibly low/high scraped amounts (e.g. $1–2 promo noise).
 * Returns undefined so callers can store/show null price.
 */
export function sanitizePrice(
  value: number | null | undefined,
): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  if (value < MIN_PRODUCT_PRICE || value > MAX_PRODUCT_PRICE) return undefined;
  return value;
}
