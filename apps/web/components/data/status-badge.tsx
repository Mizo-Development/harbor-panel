import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

const STATUS_TONE: Record<string, Tone> = {
  running: 'success',
  online: 'success',
  paid: 'success',
  active: 'success',
  starting: 'warning',
  stopping: 'warning',
  provisioning: 'warning',
  degraded: 'warning',
  maintenance: 'warning',
  pending: 'warning',
  open: 'warning',
  draft: 'neutral',
  stopped: 'neutral',
  void: 'neutral',
  refunded: 'neutral',
  offline: 'danger',
  error: 'danger',
  overdue: 'danger',
  suspended: 'danger',
};

const TONE_CLASS: Record<Tone, string> = {
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-destructive/30 bg-destructive/10 text-destructive',
  neutral: 'border-border bg-muted text-muted-foreground',
};

const DOT_CLASS: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning animate-pulse',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground/60',
};

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/[-_]/g, ' ');
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', TONE_CLASS[tone], className)}>
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT_CLASS[tone])} />
      {label ?? titleCase(status)}
    </Badge>
  );
}
