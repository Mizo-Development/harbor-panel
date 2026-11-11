import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Reveal } from '@/components/design/motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export type SurfaceProps = {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** `className` applies to the outer wrapper so it can be used for grid placement (e.g. `lg:col-span-2`). */
export function Surface({ title, description, action, children, className }: SurfaceProps) {
  const hasHeader = Boolean(title || description || action);

  return (
    <Reveal className={cn('@container/surface min-w-0 max-w-full', className)}>
      <Card className="group/surface h-full gap-0 overflow-hidden py-0 inset-surface transition-[border-color,background-color] duration-200 ease-out hover:border-ring/35">
        {hasHeader ? (
          <CardHeader
            className={cn(
              'flex min-w-0 gap-4 border-b p-4 [.border-b]:pb-4 @min-[36rem]/surface:px-6 @min-[36rem]/surface:py-5',
              description
                ? 'flex-col items-stretch @min-[48rem]/surface:flex-row @min-[48rem]/surface:items-start @min-[48rem]/surface:justify-between'
                : 'flex-row flex-wrap items-center justify-between',
            )}
          >
            <div
              className={cn(
                'flex flex-1 flex-col gap-1.5',
                description ? 'min-w-0' : 'min-w-[min(100%,8rem)]',
              )}
            >
              {title ? (
                <CardTitle className="text-sm leading-6 font-semibold tracking-tight">
                  {title}
                </CardTitle>
              ) : null}
              {description ? (
                <CardDescription className="text-[13px] leading-6 [overflow-wrap:anywhere]">
                  {description}
                </CardDescription>
              ) : null}
            </div>
            {action ? (
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 @min-[48rem]/surface:max-w-[60%] @min-[48rem]/surface:justify-end [&>div]:min-w-0 [&>div]:max-w-full [&>div]:flex-wrap">
                {action}
              </div>
            ) : null}
          </CardHeader>
        ) : null}
        <CardContent className="min-w-0 flex-1 p-4 @min-[36rem]/surface:p-6">
          {children}
        </CardContent>
      </Card>
    </Reveal>
  );
}
