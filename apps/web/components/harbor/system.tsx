'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Server,
  Clock,
  AlertCircle,
  RefreshCw,
  Play,
  ArrowUpRight,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { api, getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Header,
  Panel,
  Input,
  Select,
  Modal,
  DataTable,
  Loading,
  ErrorBox,
  useData,
  date,
  type Row,
} from './shared';
export function SystemWorkspace({ embedded = false }: { embedded?: boolean }) {
  const status = useData<Row>('/admin/system', 15000),
    [tab, setTab] = useState('status'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [errorsOnly, setErrorsOnly] = useState(true),
    [jobStatus, setJobStatus] = useState('FAILED'),
    [busy, setBusy] = useState(false),
    [details, setDetails] = useState<Row | null>(null);
  const endpoint =
    tab === 'audit' || tab === 'http'
      ? `/admin/system/${tab}?page=${page}&search=${encodeURIComponent(search)}&errorsOnly=${errorsOnly}`
      : tab === 'jobs'
        ? `/admin/system/jobs?page=${page}&search=${encodeURIComponent(search)}&status=${jobStatus}`
        : null;
  const logs = useData<Row>(endpoint, tab === 'jobs' ? 10000 : 0);
  const changeTab = (value: string) => {
    setTab(value);
    setPage(1);
    setSearch('');
  };
  return (
    <div className="space-y-5">
      {!embedded && (
        <Header
          eyebrow="Platform operations"
          title="System"
          description="Inspect activity, request outcomes, background jobs, and maintenance."
        />
      )}
      <div
        className="flex flex-wrap gap-1 rounded-lg border bg-muted/20 p-1"
        role="tablist"
        aria-label="System areas"
      >
        {[
          ['status', 'Status'],
          ['audit', 'Audit log'],
          ['http', 'HTTP log'],
          ['jobs', 'Background jobs'],
        ].map(([key, label]) => (
          <button
            type="button"
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => changeTab(key)}
            className={cn(
              'rounded-md px-4 py-2 text-xs transition-colors',
              tab === key
                ? 'bg-background font-medium shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {status.error ? (
        <ErrorBox error={status.error} retry={status.mutate} />
      ) : !status.data ? (
        <Loading />
      ) : tab === 'status' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [Server, 'Database', status.data.database],
              [Activity, 'Worker heartbeat', status.data.worker.toLowerCase()],
              [Clock, 'API uptime', `${Math.floor(status.data.uptimeSeconds / 60)} min`],
              [AlertCircle, 'API errors · 24h', String(status.data.apiErrors24h)],
            ].map(([Icon, label, value]) => {
              const I = Icon as typeof Server;
              return (
                <Panel key={label as string}>
                  <I className="mb-4 size-4 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground">{label as string}</p>
                  <p className="mt-2 text-lg font-semibold capitalize tracking-tight">
                    {value as string}
                  </p>
                </Panel>
              );
            })}
          </div>
          <Panel
            title="Maintenance"
            description="Renewals, expiry, cancellation scheduling, and job recovery."
          >
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="text-xs leading-6 text-muted-foreground">
                  The scheduled worker runs maintenance every minute. A manual run uses the same
                  task lock and business policies.
                </p>
                <Button
                  disabled={busy}
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const result = await api.post<Row>('/admin/system/maintenance');
                      if (result.complete === false) toast.error(result.message);
                      else toast.success(result.skipped ? result.message : 'Maintenance completed');
                      await status.mutate();
                    } catch (e) {
                      toast.error(getErrorMessage(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Play className="size-3.5" />
                  {busy ? 'Running…' : 'Run maintenance'}
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[11px] text-muted-foreground">
                    <tr>
                      <th className="pb-3 font-normal">Started</th>
                      <th className="pb-3 font-normal">Trigger</th>
                      <th className="pb-3 font-normal">Result</th>
                      <th className="pb-3 text-right font-normal">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.data.recentRuns.map((run: Row) => (
                      <tr key={run.id} className="border-t">
                        <td className="py-3">{date(run.startedAt)}</td>
                        <td className="capitalize">{run.origin}</td>
                        <td>
                          <Badge variant="outline">{run.status.toLowerCase()}</Badge>
                          {run.errorCode && (
                            <span className="ml-2 text-[10px] text-muted-foreground">
                              {run.errorCode}
                            </span>
                          )}
                        </td>
                        <td className="text-right font-mono">
                          {run.finishedAt
                            ? `${Math.max(0, Math.round((+new Date(run.finishedAt) - +new Date(run.startedAt)) / 1000))}s`
                            : 'In progress'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!status.data.recentRuns.length && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Waiting for the first maintenance run.
                  </p>
                )}
              </div>
            </div>
          </Panel>
          <div className="grid gap-5 sm:grid-cols-2">
            <Panel title="Hosting jobs">
              <div className="grid grid-cols-2 gap-4">
                {['PENDING', 'RUNNING', 'FAILED', 'COMPLETE'].map((key) => (
                  <button
                    type="button"
                    key={key}
                    onClick={() => {
                      changeTab('jobs');
                      setJobStatus(key);
                    }}
                    className="rounded-lg border p-3 text-left transition hover:bg-muted/30"
                  >
                    <p className="text-[10px] capitalize text-muted-foreground">
                      {key.toLowerCase()}
                    </p>
                    <p className="mt-2 text-xl font-semibold tabular-nums">
                      {status.data!.operations[key] || 0}
                    </p>
                  </button>
                ))}
              </div>
            </Panel>
            <Panel title="Installation">
              <dl className="space-y-4 text-xs">
                {[
                  ['Platform', `Harbor ${status.data.version}`],
                  ['Runtime', status.data.runtime],
                  ['Environment', status.data.environment],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-mono">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 flex flex-wrap gap-3 border-t pt-4">
                <Link
                  className="flex items-center gap-1 text-xs hover:underline"
                  href="/admin/extensions"
                >
                  Extensions <ArrowUpRight className="size-3" />
                </Link>
                <Link
                  className="flex items-center gap-1 text-xs hover:underline"
                  href="/admin/settings?section=email"
                >
                  Mail logs <ArrowUpRight className="size-3" />
                </Link>
              </div>
            </Panel>
          </div>
        </>
      ) : (
        <Panel
          title={
            tab === 'audit'
              ? 'Audited activity'
              : tab === 'http'
                ? 'HTTP requests'
                : 'Hosting background jobs'
          }
          description={
            tab === 'http'
              ? 'Headers, query strings and request bodies are not retained. HTTP records are kept for 30 days.'
              : tab === 'audit'
                ? 'Administrative and account changes are retained for traceability.'
                : 'Review failed operations and retry after resolving the underlying provider issue.'
          }
        >
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-48 flex-1">
                <Search className="absolute left-3 top-3 size-3.5 text-muted-foreground" />
                <Input
                  className="pl-9"
                  aria-label="Search system logs"
                  placeholder={
                    tab === 'audit'
                      ? 'Search action, actor or target ID…'
                      : tab === 'http'
                        ? 'Search route or request ID…'
                        : 'Search action or service…'
                  }
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              {tab === 'http' && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={errorsOnly}
                    onChange={(e) => {
                      setErrorsOnly(e.target.checked);
                      setPage(1);
                    }}
                  />
                  Errors only
                </label>
              )}
              {tab === 'jobs' && (
                <Select
                  aria-label="Job status"
                  value={jobStatus}
                  onChange={(e) => {
                    setJobStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All statuses</option>
                  {['FAILED', 'PENDING', 'RUNNING', 'COMPLETE'].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
              <Button variant="outline" size="sm" onClick={() => void logs.mutate()}>
                <RefreshCw className="size-3.5" />
                Refresh
              </Button>
            </div>
            {logs.error ? (
              <ErrorBox error={logs.error} />
            ) : !logs.data ? (
              <Loading />
            ) : (
              <>
                <DataTable
                  rows={logs.data.items}
                  empty="No matching records."
                  columns={
                    tab === 'audit'
                      ? [
                          {
                            label: 'Action',
                            render: (r) => <span className="font-mono text-xs">{r.action}</span>,
                          },
                          { label: 'When', render: (r) => date(r.createdAt) },
                          {
                            label: 'Actor',
                            render: (r) => (
                              <span className="text-xs text-muted-foreground" title={r.actorId}>
                                {r.actorId?.slice(0, 8) || 'System'}
                              </span>
                            ),
                          },
                          {
                            label: 'Details',
                            render: (r) => (
                              <Button variant="ghost" size="sm" onClick={() => setDetails(r)}>
                                Inspect
                              </Button>
                            ),
                          },
                        ]
                      : tab === 'http'
                        ? [
                            {
                              label: 'Request',
                              render: (r) => (
                                <div>
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {r.method}
                                  </span>
                                  <p className="mt-1 max-w-sm break-all font-mono text-xs">
                                    {r.path}
                                  </p>
                                </div>
                              ),
                            },
                            {
                              label: 'Status',
                              render: (r) => <Badge variant="outline">{r.status}</Badge>,
                            },
                            {
                              label: 'Time',
                              render: (r) => (
                                <span className="font-mono text-xs">{r.durationMs} ms</span>
                              ),
                            },
                            { label: 'When', render: (r) => date(r.createdAt) },
                            {
                              label: 'Trace',
                              render: (r) => (
                                <Button variant="ghost" size="sm" onClick={() => setDetails(r)}>
                                  Inspect
                                </Button>
                              ),
                            },
                          ]
                        : [
                            {
                              label: 'Service',
                              render: (r) => (
                                <Link
                                  className="text-xs hover:underline"
                                  href={`/admin/services/${r.service.id}`}
                                >
                                  {r.service.name}
                                </Link>
                              ),
                            },
                            {
                              label: 'Action',
                              render: (r) => <span className="text-xs">{r.action}</span>,
                            },
                            {
                              label: 'Status',
                              render: (r) => (
                                <div>
                                  <Badge variant="outline">{r.status.toLowerCase()}</Badge>
                                  {r.error && (
                                    <p className="mt-2 max-w-sm text-[11px] text-muted-foreground">
                                      {r.error}
                                    </p>
                                  )}
                                </div>
                              ),
                            },
                            { label: 'Attempts', render: (r) => String(r.attempts) },
                            {
                              label: 'Retry',
                              render: (r) =>
                                r.status === 'FAILED' ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={
                                      busy ||
                                      r.service.status === 'TERMINATED' ||
                                      (r.action !== 'terminate' &&
                                        r.service.cancelAt &&
                                        new Date(r.service.cancelAt) <= new Date())
                                    }
                                    onClick={async () => {
                                      setBusy(true);
                                      try {
                                        await api.post(`/operations/${r.id}/retry`);
                                        await logs.mutate();
                                        await status.mutate();
                                        toast.success('Operation queued');
                                      } catch (e) {
                                        toast.error(getErrorMessage(e));
                                      } finally {
                                        setBusy(false);
                                      }
                                    }}
                                  >
                                    Retry job
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                ),
                            },
                          ]
                  }
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{logs.data.total} records</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page * 25 >= logs.data.total}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </Panel>
      )}
      {details && (
        <Modal
          title={tab === 'audit' ? 'Audit record' : 'Request trace'}
          close={() => setDetails(null)}
        >
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 p-4 font-mono text-[11px] leading-6">
            {JSON.stringify(details, null, 2)}
          </pre>
        </Modal>
      )}
    </div>
  );
}
