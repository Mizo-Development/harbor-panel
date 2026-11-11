import { Progress } from '@/components/ui/progress';
import { formatBytes, percentOf } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Usage meter. Pass `used`/`limit` in bytes, or `percent` directly (for CPU). */
export function ResourceBar({
  label,
  used,
  limit,
  percent,
  className,
}: {
  label: string;
  used?: number | null;
  limit?: number | null;
  percent?: number | null;
  className?: string;
}) {
  const value = percent ?? percentOf(used, limit);
  const readout =
    percent !== undefined && percent !== null
      ? `${percent.toFixed(0)}%`
      : used !== undefined && used !== null
        ? `${formatBytes(used)}${limit ? ` / ${formatBytes(limit)}` : ''}`
        : '—';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums text-foreground">{readout}</span>
      </div>
      <Progress
        value={value ?? 0}
        aria-label={`${label} usage`}
        className={cn('h-1.5', value !== null && value >= 90 && '[&>*]:bg-destructive')}
      />
    </div>
  );
}
