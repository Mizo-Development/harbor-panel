'use client';
import { motion, useReducedMotion } from 'motion/react';
import { PageHeading } from '@/components/design/page-heading';
import { BrandIcon } from '@/components/design/brand-icon';
import { Surface } from '@/components/design/surface';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  useEffect,
  useRef,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type FormEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  Anchor,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Activity,
  Bell,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  Copy,
  CreditCard,
  Database,
  ExternalLink,
  File,
  Folder,
  Gamepad2,
  Globe2,
  HardDrive,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Palette,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Square,
  Terminal,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { VpsConsole } from '@/components/vps-console';
import {
  ExtensionLayout,
  ExtensionSlot,
  ExtensionPage,
  extensionPages,
} from '@/components/extension-runtime';
import { api, apiFetch, ApiError, getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { StatusBadge } from '@/components/data/status-badge';
import { Button } from '@/components/ui/button';

export type Row = Record<string, any>;

export function useData<T = any>(path: string | null, interval = 0) {
  return useSWR<T, ApiError>(path, (p: string) => apiFetch<T>(p), {
    refreshInterval: interval,
    shouldRetryOnError: false,
  });
}

const formatLocale = () =>
  typeof document === 'undefined' ? 'en-US' : document.documentElement.dataset.locale || 'en-US';
export const money = (n: number, c = 'USD') =>
  new Intl.NumberFormat(formatLocale(), { style: 'currency', currency: c }).format(
    (n || 0) / (['JPY', 'KRW', 'VND'].includes(c) ? 1 : 100),
  );

export const date = (d: string) =>
  d
    ? new Intl.DateTimeFormat(formatLocale(), {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date(d))
    : '—';

export const kindIcon = (kind: string) =>
  kind === 'game' ? Gamepad2 : kind === 'vps' ? Boxes : Globe2;

export function Loading() {
  return (
    <div
      className="flex min-h-64 items-center justify-center gap-3 text-sm text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-5 animate-spin" />
      Loading your workspace…
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => unknown }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-destructive/20 bg-destructive/5 p-5 text-sm"
    >
      <p className="font-medium text-destructive">{getErrorMessage(error)}</p>
      {retry && (
        <Button className="mt-3" size="sm" variant="outline" onClick={() => retry()}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Empty({
  icon: Icon = Package,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-2xl border bg-card shadow-sm">
        <Icon className="size-5 text-muted-foreground" />
      </span>
      <h3 className="font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Header(props: React.ComponentProps<typeof PageHeading>) {
  return <PageHeading {...props} />;
}
export function Panel(props: React.ComponentProps<typeof Surface>) {
  return <Surface {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 text-sm font-medium">
      <Label htmlFor={id} className="text-[13px] font-medium">
        {label}
      </Label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            id,
            'aria-describedby': hint ? `${id}-hint` : undefined,
          })
        : children}
      {hint && (
        <span id={`${id}-hint`} className="text-xs font-normal leading-5 text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}

export const inputClass =
  'h-10 w-full rounded-md border border-input bg-transparent px-3 text-[13px] font-normal shadow-xs outline-none transition-[color,box-shadow] duration-150 dark:bg-input/30 focus:border-ring focus:ring-[3px] focus:ring-ring/30 disabled:opacity-50';

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <ShadcnInput {...p} className={cn('h-10 text-base md:text-[13px]', p.className)} />;
}
export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...p} className={cn(inputClass, 'appearance-none pr-9', p.className)} />
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  close,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  close: () => void;
}) {
  const [open, setOpen] = useState(true);
  const callback = useRef(close);
  callback.current = close;
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => callback.current(), 180);
    return () => clearTimeout(timer);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden border-border/80 p-0 shadow-2xl sm:max-w-xl"
      >
        <DialogHeader className="shrink-0 border-b p-4 text-left sm:px-6 sm:py-5">
          <DialogTitle className="pr-10 text-base leading-6 font-semibold tracking-tight [overflow-wrap:anywhere]">
            {title}
          </DialogTitle>
          <DialogDescription className={cn('text-[13px] leading-6', !description && 'sr-only')}>
            {description || `Manage ${title.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-4 top-4 text-muted-foreground"
            aria-label="Close dialog"
          >
            <X className="size-4" />
          </Button>
        </DialogClose>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:px-6 sm:py-5">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Form({
  children,
  onSubmit,
  submit = 'Save changes',
  disabled = false,
  close,
  secondaryAction,
}: {
  children: ReactNode;
  onSubmit: (data: FormData) => Promise<unknown>;
  submit?: string;
  disabled?: boolean;
  close?: () => void;
  secondaryAction?: ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled || busy) return;
        setBusy(true);
        setError(null);
        const data = new FormData(e.currentTarget);
        try {
          await onSubmit(data);
        } catch (err) {
          setError(err);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      {error ? <ErrorBox error={error} /> : null}
      <div className="harbor-form-actions mt-2 flex flex-wrap justify-end gap-2">
        {close && (
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
        )}
        {secondaryAction}
        <Button disabled={busy || disabled} type="submit">
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {submit}
        </Button>
      </div>
    </form>
  );
}

export function DataTable({
  rows,
  columns,
  empty = 'Nothing here yet',
  mobileLayout = 'records',
}: {
  rows: Row[];
  columns: Array<{ label: string; render: (r: Row) => ReactNode }>;
  empty?: string;
  mobileLayout?: 'records' | 'files';
}) {
  const [q, setQ] = useState('');
  const reduce = useReducedMotion();
  const filtered = rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  return (
    <div
      className="harbor-data-table min-w-0 max-w-full overflow-hidden rounded-xl border border-border/80 bg-card"
      data-mobile-layout={mobileLayout}
    >
      <div className="flex items-center justify-between gap-4 border-b border-border/70 p-3.5">
        <div className="relative w-full max-w-[280px]">
          <Search
            aria-hidden
            className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search records…"
            aria-label="Search records"
            className="h-9 border-border/80 bg-background/50 pl-9 text-xs shadow-none"
          />
        </div>
        <span className="shrink-0 rounded-md border border-border/60 bg-muted/30 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {filtered.length} records
        </span>
      </div>
      <Table className="harbor-responsive-table" role="table">
        <TableHeader className="bg-muted/20" role="rowgroup">
          <TableRow className="hover:bg-transparent" role="row">
            {columns.map((c) => (
              <TableHead
                key={c.label}
                scope="col"
                role="columnheader"
                className="h-10 px-4 text-[11px] font-medium text-muted-foreground"
              >
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody role="rowgroup">
          {filtered.map((r, i) => (
            <motion.tr
              key={r.id || i}
              role="row"
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: Math.min(i, 8) * 0.018 }}
              className="group border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30"
            >
              {columns.map((c) => (
                <TableCell
                  key={c.label}
                  role="cell"
                  data-label={c.label}
                  className="px-4 py-4 text-[13px]"
                >
                  <span aria-hidden="true" className="harbor-cell-label">
                    {c.label}
                  </span>
                  <div className="harbor-cell-content min-w-0">{c.render(r)}</div>
                </TableCell>
              ))}
            </motion.tr>
          ))}
        </TableBody>
      </Table>
      {!filtered.length && (
        <div className="flex min-h-44 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <span className="flex size-9 items-center justify-center rounded-lg border bg-muted/30">
            <Search className="size-4 text-muted-foreground/60" />
          </span>
          <p className="text-[13px] text-muted-foreground">{q ? 'No matching records' : empty}</p>
        </div>
      )}
    </div>
  );
}

export async function mutateAction(task: () => Promise<any>, success = 'Changes saved') {
  try {
    const data = await task();
    toast.success(data?.message || success);
    return data;
  } catch (error) {
    toast.error(getErrorMessage(error));
    throw error;
  }
}

export function Brand({ name = 'Harbor' }: { name?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandIcon />
      <span className="max-w-[100px] sm:max-w-[140px] truncate text-base font-semibold tracking-tight">
        {name}
      </span>
    </span>
  );
}
