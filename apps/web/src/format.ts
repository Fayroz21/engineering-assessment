import type { ApplicationStatus } from "@assessment/contracts";

/** Customer-facing formatting currently targets Egypt (DOMAIN.md:62). */
const LOCALE = "en-EG";

export function formatStatus(status: ApplicationStatus | string): string {
  return status
    .toLowerCase()
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Money is stored as integer minor units. `Intl` is given the minor units and
 * told the scale, so the value is never divided in floating point.
 */
export function formatMoney(amountInCents: number, currency: string): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amountInCents / 100);
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
