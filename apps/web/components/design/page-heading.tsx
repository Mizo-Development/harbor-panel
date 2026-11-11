import type { ReactNode } from 'react';
import { Reveal } from '@/components/design/motion';
export type PageHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
};
export function PageHeading({ eyebrow, title, description, action }: PageHeadingProps) {
  return (
    <Reveal className="@container/page-heading min-w-0 pb-6 sm:pb-8">
      <div className="flex min-w-0 flex-col gap-5 @min-[48rem]/page-heading:flex-row @min-[48rem]/page-heading:items-center @min-[48rem]/page-heading:justify-between @min-[48rem]/page-heading:gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {eyebrow && (
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {eyebrow}
            </p>
          )}
          <h1 className="text-2xl leading-tight font-semibold tracking-tight break-words text-foreground [overflow-wrap:anywhere] sm:text-[28px]">
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm leading-6 text-pretty text-muted-foreground [overflow-wrap:anywhere]">
              {description}
            </p>
          )}
        </div>
        {action && (
          <div className="harbor-page-actions flex min-w-0 max-w-full flex-wrap items-center gap-2 @min-[48rem]/page-heading:max-w-[50%] @min-[48rem]/page-heading:justify-end [&>div]:min-w-0 [&>div]:max-w-full [&>div]:flex-wrap">
            {action}
          </div>
        )}
      </div>
    </Reveal>
  );
}
