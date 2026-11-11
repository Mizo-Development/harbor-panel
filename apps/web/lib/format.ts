import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

import type { BillingInterval, DashboardMetric } from '@/lib/types';

const digitsCache = new Map<string, number>();

function minorUnitDigits(currency: string): number {
  const cached = digitsCache.get(currency);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  digitsCache.set(currency, digits);
  return digits;
}

/** Converts an API amount in minor units (cents) to a major-unit number. */
export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** minorUnitDigits(currency);
}

export function formatMoney(
  minor: number | null | undefined,
  currency: string | null | undefined,
): string {
  if (minor === null || minor === undefined || !currency) return '—';
  const major = toMajor(minor, currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

export function formatCompactMoney(minor: number, currency: string): string {
  const major = toMajor(minor, currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(major);
  } catch {
    return String(Math.round(major));
  }
}

export function formatMetricValue(metric: DashboardMetric, currency: string): string {
  switch (metric.format) {
    case 'currency':
      return formatMoney(metric.value, currency);
    case 'percent':
      return `${metric.value.toFixed(1)}%`;
    default:
      return new Intl.NumberFormat().format(metric.value);
  }
}

export function formatDate(value: string | null | undefined, pattern = 'MMM d, yyyy'): string {
  if (!value) return '—';
  const date = parseISO(value);
  return isValid(date) ? format(date, pattern) : '—';
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const date = parseISO(value);
  return isValid(date) ? formatDistanceToNowStrict(date, { addSuffix: true }) : '—';
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

const INTERVAL_SUFFIX: Record<BillingInterval, string> = {
  hour: 'hr',
  day: 'day',
  week: 'wk',
  month: 'mo',
  quarter: 'qtr',
  year: 'yr',
};

export function intervalSuffix(interval: BillingInterval | null | undefined): string {
  return interval ? (INTERVAL_SUFFIX[interval] ?? interval) : '';
}

export function initials(name: string | null | undefined, fallback: string): string {
  const source = (name?.trim() || fallback).replace(/@.*/, '');
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

export function percentOf(
  used: number | null | undefined,
  total: number | null | undefined,
): number | null {
  if (used === null || used === undefined || !total) return null;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

/** Only allow same-origin relative redirect targets. */
export function safeRedirect(target: string | null | undefined): string | null {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\'))
    return null;
  return target;
}
