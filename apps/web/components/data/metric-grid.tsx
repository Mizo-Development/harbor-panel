'use client';

import { BarChart3, TrendingDown, TrendingUp } from 'lucide-react';

import { EmptyState, MetricGridSkeleton } from '@/components/data/states';
import { Query } from '@/components/data/query';
import { Card, CardContent } from '@/components/ui/card';
import { formatMetricValue } from '@/lib/format';
import { useDashboard } from '@/lib/hooks';
import type { DashboardMetric } from '@/lib/types';
import { cn } from '@/lib/utils';

function MetricCard({ metric, currency }: { metric: DashboardMetric; currency: string }) {
  const change = metric.change;
  const positive = change !== null && change !== undefined && change >= 0;

  return (
    <Card className="gap-3 py-5 shadow-none">
      <CardContent className="flex flex-col gap-2 px-5">
        <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">
          {formatMetricValue(metric, currency)}
        </p>
        <div className="flex min-h-5 items-center gap-2 text-xs">
          {change !== null && change !== undefined ? (
            <span
              className={cn(
                'flex items-center gap-1 font-medium tabular-nums',
                positive ? 'text-success' : 'text-destructive',
              )}
            >
              {positive ? (
                <TrendingUp className="size-3.5" />
              ) : (
                <TrendingDown className="size-3.5" />
              )}
              {positive ? '+' : ''}
              {change.toFixed(1)}%
            </span>
          ) : null}
          {metric.description ? (
            <span className="text-muted-foreground">{metric.description}</span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Metric cards driven entirely by `GET /dashboard`. */
export function MetricGrid() {
  const dashboard = useDashboard();

  return (
    <Query
      result={dashboard}
      skeleton={<MetricGridSkeleton />}
      isEmpty={(data) => !data.metrics?.length}
      empty={
        <EmptyState
          icon={BarChart3}
          title="No metrics yet"
          description="Metrics appear here once your first orders and invoices are recorded."
        />
      }
    >
      {(data) => (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {data.metrics.map((metric) => (
            <MetricCard key={metric.key} metric={metric} currency={data.currency} />
          ))}
        </div>
      )}
    </Query>
  );
}
