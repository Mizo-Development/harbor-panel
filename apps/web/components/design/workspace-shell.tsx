'use client';
import { BrandIcon } from './brand-icon';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState, useTransition, type ReactNode } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react';
import {
  Anchor,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronsUpDown,
  CircleDashed,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  Menu,
  Network,
  Package,
  Palette,
  Puzzle,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  ShoppingCart,
  UserRound,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { PageTransition, spring } from '@/components/design/motion';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Kbd, KbdGroup } from '@/components/ui/kbd';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';

export type WorkspaceNavItem = { label: string; href: string; icon: string };

export type WorkspaceShellProps = {
  companyName: string;
  user: { name?: string; email: string; role: string };
  admin: boolean;
  pathname: string;
  storefrontEnabled: boolean;
  items: WorkspaceNavItem[];
  children: ReactNode;
  themeToggle: ReactNode;
  onSignOut: () => Promise<void>;
  sidebarExtra?: ReactNode;
};

type ResolvedItem = WorkspaceNavItem & { Icon: LucideIcon; path: string };
type NavGroup = { label: string; items: ResolvedItem[] };
type Crumb = { label: string; href: string; mono?: boolean };

const ICONS: Record<string, LucideIcon> = {
  overview: LayoutGrid,
  services: Server,
  'my services': Boxes,
  customers: Users,
  products: Package,
  'game eggs': Package,
  pricing: FileText,
  coupons: FileText,
  taxes: FileText,
  cancellations: Workflow,
  'payment reviews': FileText,
  wallet: FileText,
  wallets: FileText,
  proxmox: Network,
  orders: ShoppingCart,
  invoices: FileText,
  infrastructure: Network,
  operations: Workflow,
  extensions: Puzzle,
  themes: Palette,
  settings: Settings2,
  account: UserRound,
  support: FileText,
};

const GROUP_ORDER = {
  admin: ['Platform', 'Commerce', 'System', 'Account', 'More'],
  customer: ['Workspace', 'Billing', 'System', 'Account', 'More'],
};

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function resolveIcon(icon: string, label: string): LucideIcon {
  return ICONS[normalize(icon)] ?? ICONS[normalize(label)] ?? CircleDashed;
}

function groupFor(label: string, admin: boolean) {
  const key = normalize(label);
  if (['overview', 'services', 'my services', 'customers'].includes(key))
    return admin ? 'Platform' : 'Workspace';
  if (
    [
      'products',
      'categories',
      'pricing',
      'coupons',
      'cancellations',
      'payment reviews',
      'taxes',
      'orders',
      'invoices',
      'wallet',
      'wallets',
    ].includes(key)
  )
    return admin ? 'Commerce' : 'Billing';
  if (
    ['infrastructure', 'proxmox', 'operations', 'extensions', 'themes', 'game eggs'].includes(key)
  )
    return 'System';
  if (key === 'settings') return admin ? 'System' : 'Account';
  if (key === 'account') return 'Account';
  if (['api keys', 'api access'].includes(key)) return admin ? 'System' : 'Account';
  if (key === 'support') return admin ? 'System' : 'Account';
  return 'More';
}

function toPath(href: string) {
  const path = href.split(/[?#]/)[0] || '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function resolveItems(items: WorkspaceNavItem[]): ResolvedItem[] {
  return items.map((item) => ({
    ...item,
    Icon: resolveIcon(item.icon, item.label),
    path: toPath(item.href),
  }));
}

function buildGroups(items: ResolvedItem[], admin: boolean): NavGroup[] {
  const buckets = new Map<string, ResolvedItem[]>();
  for (const item of items) {
    const group = groupFor(item.label, admin);
    buckets.set(group, [...(buckets.get(group) ?? []), item]);
  }
  return GROUP_ORDER[admin ? 'admin' : 'customer']
    .filter((label) => buckets.has(label))
    .map((label) => ({ label, items: buckets.get(label)! }));
}

function findActive(pathname: string, items: ResolvedItem[]) {
  const current = toPath(pathname);
  let best: ResolvedItem | null = null;
  for (const item of items) {
    const matches =
      current === item.path || (item.path !== '/' && current.startsWith(`${item.path}/`));
    if (matches && (!best || item.path.length > best.path.length)) best = item;
  }
  return best;
}

function humanize(segment: string): Omit<Crumb, 'href'> {
  let decoded = segment;
  try {
    decoded = decodeURIComponent(segment);
  } catch {}
  const looksLikeId =
    /^\d+$/.test(decoded) || (/^[0-9a-z_-]{16,}$/i.test(decoded) && /\d/.test(decoded));
  if (looksLikeId) {
    return {
      label: decoded.length > 12 ? `${decoded.slice(0, 8)}…` : decoded,
      mono: true,
    };
  }
  const words = decoded.replace(/[-_]+/g, ' ');
  return { label: words.charAt(0).toUpperCase() + words.slice(1) };
}

function buildCrumbs(
  pathname: string,
  root: string,
  rootLabel: string,
  active: ResolvedItem | null,
): Crumb[] {
  const crumbs: Crumb[] = [{ label: rootLabel, href: root }];
  const current = toPath(pathname);
  const base = active?.path ?? root;
  if (active) crumbs.push({ label: active.label, href: active.path });
  if (current.startsWith(base)) {
    let acc = base === '/' ? '' : base;
    for (const segment of current.slice(base.length).split('/').filter(Boolean)) {
      acc += `/${segment}`;
      crumbs.push({ ...humanize(segment), href: acc });
    }
  }
  return crumbs;
}

function initialsOf(user: WorkspaceShellProps['user']) {
  const source = user.name?.trim() || user.email.split('@')[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'U';
}

function useIsMac() {
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(navigator.userAgent));
  }, []);
  return isMac;
}

function BrandMark() {
  return <BrandIcon className="size-7" />;
}

function WorkspaceSwitcher({
  companyName,
  admin,
  canSwitch,
  onNavigate,
}: {
  companyName: string;
  admin: boolean;
  canSwitch: boolean;
  onNavigate?: () => void;
}) {
  const workspaceLabel = admin ? 'Admin console' : 'Client dashboard';
  const content = (
    <>
      <BrandMark />
      <span className="flex min-w-0 flex-1 flex-col text-left leading-tight">
        <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
          {companyName}
        </span>
        <span className="truncate text-xs text-muted-foreground">{workspaceLabel}</span>
      </span>
    </>
  );

  if (!canSwitch) {
    return (
      <Link
        href={admin ? '/admin' : '/dashboard'}
        onClick={onNavigate}
        className="flex h-11 items-center gap-2.5 rounded-md px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/60"
      >
        {content}
      </Link>
    );
  }

  const workspaces = [
    { label: 'Admin console', href: '/admin', Icon: ShieldCheck, current: admin },
    { label: 'Client dashboard', href: '/dashboard', Icon: LayoutDashboard, current: !admin },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 w-full items-center gap-2.5 rounded-md px-1.5 outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring/60 data-[state=open]:bg-sidebar-accent/60">
        {content}
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Switch workspace</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-60">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        {workspaces.map(({ label, href, Icon, current }) => (
          <DropdownMenuItem key={href} asChild>
            <Link href={href} onClick={onNavigate} aria-current={current ? 'page' : undefined}>
              <Icon aria-hidden />
              <span className="flex-1">{label}</span>
              {current ? <Check className="text-success" aria-hidden /> : null}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: ResolvedItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex h-11 items-center gap-2.5 xl:h-8 rounded-md px-2.5 text-[13px] font-medium outline-none',
        'transition-[color,background-color,transform] duration-150 active:scale-[0.985]',
        'focus-visible:ring-2 focus-visible:ring-sidebar-ring/60',
        active
          ? 'text-sidebar-foreground'
          : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
      )}
    >
      {active ? (
        <motion.span
          layoutId="nav-active-pill"
          transition={spring}
          className="absolute inset-0 rounded-md border border-sidebar-border bg-sidebar-accent inset-surface"
        />
      ) : null}
      <Icon
        aria-hidden
        className={cn(
          'relative size-4 shrink-0 transition-colors',
          active
            ? 'text-sidebar-foreground'
            : 'text-muted-foreground group-hover:text-sidebar-foreground',
        )}
      />
      <span className="relative truncate">{item.label}</span>
    </Link>
  );
}

function AccountMenu({
  user,
  admin,
  canSwitch,
  accountHref,
  onSignOut,
  onNavigate,
}: {
  user: WorkspaceShellProps['user'];
  admin: boolean;
  canSwitch: boolean;
  accountHref?: string;
  onSignOut: () => Promise<void>;
  onNavigate?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const displayName = user.name?.trim() || user.email.split('@')[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-11 w-full items-center gap-2.5 rounded-md px-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring/60 data-[state=open]:bg-sidebar-accent/60">
        <Avatar className="size-7 rounded-md">
          <AvatarFallback className="rounded-md bg-secondary text-[11px] font-medium text-secondary-foreground">
            {initialsOf(user)}
          </AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[13px] font-medium text-sidebar-foreground">
            {displayName}
          </span>
          <span className="truncate text-xs text-muted-foreground">{user.email}</span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Open account menu</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
      >
        <DropdownMenuLabel className="flex items-center justify-between gap-2 font-normal">
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
          <Badge variant="outline" className="shrink-0 capitalize">
            {user.role}
          </Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {accountHref ? (
            <DropdownMenuItem asChild>
              <Link href={accountHref} onClick={onNavigate}>
                <UserRound aria-hidden />
                Account
              </Link>
            </DropdownMenuItem>
          ) : null}
          {canSwitch ? (
            <DropdownMenuItem asChild>
              <Link href={admin ? '/dashboard' : '/admin'} onClick={onNavigate}>
                {admin ? <LayoutDashboard aria-hidden /> : <ShieldCheck aria-hidden />}
                {admin ? 'Client dashboard' : 'Admin console'}
              </Link>
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        {accountHref || canSwitch ? <DropdownMenuSeparator /> : null}
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(async () => {
              await onSignOut();
            });
          }}
        >
          {pending ? <Spinner /> : <LogOut aria-hidden />}
          {pending ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SearchTrigger({
  onOpen,
  isMac,
  className,
}: {
  onOpen: () => void;
  isMac: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex h-8 items-center gap-2 rounded-md border bg-background/50 px-2.5 text-[13px] text-muted-foreground inset-surface outline-none',
        'transition-[color,background-color,border-color] duration-150 hover:border-ring/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
        className,
      )}
    >
      <Search className="size-3.5 shrink-0" aria-hidden />
      <span className="flex-1 text-left">Search</span>
      <KbdGroup aria-hidden>
        <Kbd>{isMac ? '⌘' : 'Ctrl'}</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
      <span className="sr-only">{`Open search (${isMac ? 'Command' : 'Control'} K)`}</span>
    </button>
  );
}

function SidebarBody({
  layoutGroupId,
  companyName,
  user,
  admin,
  canSwitch,
  storefrontEnabled,
  groups,
  active,
  accountHref,
  isMac,
  onSearch,
  onSignOut,
  onNavigate,
  inSheet,
  sidebarExtra,
}: {
  layoutGroupId: string;
  companyName: string;
  user: WorkspaceShellProps['user'];
  admin: boolean;
  canSwitch: boolean;
  storefrontEnabled: boolean;
  groups: NavGroup[];
  active: ResolvedItem | null;
  accountHref?: string;
  isMac: boolean;
  onSearch: () => void;
  onSignOut: () => Promise<void>;
  onNavigate?: () => void;
  inSheet?: boolean;
  sidebarExtra?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-14 shrink-0 items-center px-2', inSheet && 'pr-10')}>
        <WorkspaceSwitcher
          companyName={companyName}
          admin={admin}
          canSwitch={canSwitch}
          onNavigate={onNavigate}
        />
      </div>

      <div className="px-3 pb-2">
        <SearchTrigger onOpen={onSearch} isMac={isMac} className="w-full" />
      </div>

      <LayoutGroup id={layoutGroupId}>
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-3">
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </p>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <NavLink
                      item={item}
                      active={active?.href === item.href}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {sidebarExtra}
        </nav>
      </LayoutGroup>

      <div className="flex shrink-0 flex-col gap-1 border-t border-sidebar-border p-2">
        {storefrontEnabled ? (
          <a
            href="/store"
            className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/60"
          >
            <ArrowUpRight className="size-4" aria-hidden />
            View storefront
          </a>
        ) : null}
        <AccountMenu
          user={user}
          admin={admin}
          canSwitch={canSwitch}
          accountHref={accountHref}
          onSignOut={onSignOut}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

function CommandMenu({
  open,
  onOpenChange,
  groups,
  active,
  admin,
  canSwitch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: NavGroup[];
  active: ResolvedItem | null;
  admin: boolean;
  canSwitch: boolean;
}) {
  const router = useRouter();
  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search navigation"
      description="Jump to any page in this workspace"
      className="sm:max-w-lg"
    >
      <CommandInput placeholder="Search pages…" />
      <CommandList className="max-h-96">
        <CommandEmpty>No matching pages.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map(({ Icon, ...item }) => (
              <CommandItem
                key={item.href}
                value={`${item.label} ${group.label} ${item.path}`}
                onSelect={() => go(item.href)}
              >
                <Icon aria-hidden />
                <span>{item.label}</span>
                {active?.href === item.href ? (
                  <CommandShortcut className="tracking-normal">Current</CommandShortcut>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {canSwitch ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Workspace">
              <CommandItem
                value="switch workspace admin dashboard"
                onSelect={() => go(admin ? '/dashboard' : '/admin')}
              >
                {admin ? <LayoutDashboard aria-hidden /> : <ShieldCheck aria-hidden />}
                <span>{admin ? 'Switch to client dashboard' : 'Switch to admin console'}</span>
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap gap-1.5 text-[13px] sm:gap-2">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.href}-${index}`}>
              <BreadcrumbItem className={cn('min-w-0', !last && 'hidden md:inline-flex')}>
                {last ? (
                  <BreadcrumbPage
                    className={cn('truncate font-medium', crumb.mono && 'font-mono text-xs')}
                  >
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    asChild
                    className={cn('truncate', crumb.mono && 'font-mono text-xs')}
                  >
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last ? (
                <BreadcrumbSeparator className="hidden text-muted-foreground/50 md:block">
                  <span className="text-xs">/</span>
                </BreadcrumbSeparator>
              ) : null}
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function RouteProgress({ pathname }: { pathname: string }) {
  return (
    <AnimatePresence initial={false}>
      <motion.span
        key={pathname}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -bottom-px h-px origin-left bg-gradient-to-r from-transparent via-foreground/70 to-transparent"
        initial={{ scaleX: 0, opacity: 1 }}
        animate={{ scaleX: 1, opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{
          scaleX: { duration: 0.55, ease: [0.22, 1, 0.36, 1] },
          opacity: { duration: 0.35, delay: 0.4 },
        }}
      />
    </AnimatePresence>
  );
}

export function WorkspaceShell({
  companyName,
  user,
  admin,
  pathname,
  storefrontEnabled,
  items,
  children,
  themeToggle,
  onSignOut,
  sidebarExtra,
}: WorkspaceShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const isMac = useIsMac();

  const resolved = useMemo(() => resolveItems(items), [items]);
  const groups = useMemo(() => buildGroups(resolved, admin), [resolved, admin]);
  const active = useMemo(() => findActive(pathname, resolved), [pathname, resolved]);
  const canSwitch = normalize(user.role) === 'admin';
  const root = admin ? '/admin' : '/dashboard';
  const crumbs = useMemo(
    () => buildCrumbs(pathname, root, admin ? 'Admin' : 'Dashboard', active),
    [pathname, root, admin, active],
  );
  const accountHref =
    resolved.find((item) => normalize(item.label) === 'account')?.href ??
    resolved.find((item) => normalize(item.label) === 'settings')?.href;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openSearch = () => {
    setMobileOpen(false);
    setCommandOpen(true);
  };

  const sidebarProps = {
    companyName,
    user,
    admin,
    canSwitch,
    storefrontEnabled,
    groups,
    active,
    accountHref,
    isMac,
    onSearch: openSearch,
    onSignOut,
    sidebarExtra,
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-svh bg-background">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
        >
          Skip to main content
        </a>

        <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-sidebar-border bg-sidebar xl:block">
          <SidebarBody layoutGroupId="sidebar-desktop" {...sidebarProps} />
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent
            side="left"
            className="w-[min(20rem,calc(100vw-2rem))] gap-0 border-sidebar-border bg-sidebar p-0 sm:max-w-80"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>{`${companyName} workspace navigation`}</SheetDescription>
            </SheetHeader>
            <SidebarBody
              layoutGroupId="sidebar-mobile"
              inSheet
              onNavigate={() => setMobileOpen(false)}
              {...sidebarProps}
            />
          </SheetContent>
        </Sheet>

        <div className="flex min-h-svh min-w-0 flex-col xl:pl-60">
          <header className="sticky top-0 z-20 flex h-16 min-w-0 shrink-0 items-center gap-2 border-b bg-background/75 sm:h-14 sm:gap-3 px-4 backdrop-blur-xl lg:px-8">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1.5 size-10 xl:hidden"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-4" aria-hidden />
              <span className="sr-only">Open navigation</span>
            </Button>
            <span aria-hidden className="h-4 w-px bg-border xl:hidden" />

            <Breadcrumbs crumbs={crumbs} />

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <SearchTrigger onOpen={openSearch} isMac={isMac} className="hidden w-56 md:flex" />
              <Button variant="ghost" size="icon" className="size-8 md:hidden" onClick={openSearch}>
                <Search className="size-4" aria-hidden />
                <span className="sr-only">Search</span>
              </Button>
              {themeToggle}
            </div>

            <RouteProgress pathname={pathname} />
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
          >
            <PageTransition key={pathname}>{children}</PageTransition>
          </main>
        </div>

        <CommandMenu
          open={commandOpen}
          onOpenChange={setCommandOpen}
          groups={groups}
          active={active}
          admin={admin}
          canSwitch={canSwitch}
        />
      </div>
    </MotionConfig>
  );
}
