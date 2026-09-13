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
