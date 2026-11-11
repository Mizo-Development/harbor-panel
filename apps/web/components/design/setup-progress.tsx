'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import { spring } from '@/components/design/motion';

export type SetupProgressProps = {
  /** Zero-based index of the current step. */
  step: number;
  steps: string[];
};

export function SetupProgress({ step, steps }: SetupProgressProps) {
  const reduce = useReducedMotion();
  const total = steps.length;
  if (total === 0) return null;

  const current = Math.min(Math.max(step, 0), total - 1);
  const percent = ((current + 1) / total) * 100;

  return (
    <nav aria-label="Setup progress" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4 text-xs">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={current}
            className="truncate font-medium text-foreground"
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {steps[current]}
          </motion.span>
        </AnimatePresence>
        <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
          {`Step ${current + 1} of ${total}`}
        </span>
      </div>

      <div
        role="progressbar"
        aria-label="Setup completion"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        className="relative h-1 overflow-hidden rounded-full bg-muted"
      >
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-foreground"
          initial={false}
          animate={{ width: `${percent}%` }}
          transition={reduce ? { duration: 0 } : spring}
        />
      </div>

      <ol className="flex items-center gap-2">
        {steps.map((label, index) => {
          const state = index < current ? 'complete' : index === current ? 'current' : 'upcoming';
          return (
            <li
              key={label}
              aria-current={state === 'current' ? 'step' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2"
            >
              <span
                className={cn(
                  'relative flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium tabular-nums transition-colors duration-200',
                  state === 'complete' && 'border-success/40 bg-success/15 text-success',
                  state === 'current' && 'border-foreground bg-foreground text-background',
                  state === 'upcoming' && 'border-border text-muted-foreground',
                )}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {state === 'complete' ? (
                    <motion.span
                      key="check"
                      initial={reduce ? false : { scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0 }}
                      transition={spring}
                    >
                      <Check className="size-3" strokeWidth={3} aria-hidden />
                    </motion.span>
                  ) : (
                    <motion.span
                      key="index"
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.12 }}
                    >
                      {index + 1}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span
                className={cn(
                  'hidden truncate text-xs sm:block',
                  state === 'upcoming' ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {label}
              </span>
              <span className="sr-only">
                {state === 'complete' ? ' (completed)' : state === 'current' ? ' (current)' : ''}
              </span>
              {index < total - 1 ? (
                <span
                  aria-hidden
                  className={cn(
                    'h-px min-w-3 flex-1 transition-colors duration-300',
                    index < current ? 'bg-success/40' : 'bg-border',
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
