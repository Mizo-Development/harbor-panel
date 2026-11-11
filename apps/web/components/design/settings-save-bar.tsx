// Adapted from the v0 Max settings design, chat r6XqCiZfi01.
'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';

type SaveBarProps = {
  sectionLabel: string;
  count: number;
  errorCount: number;
  otherSections: number;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
};

export function SaveBar({
  sectionLabel,
  count,
  errorCount,
  otherSections,
  saving,
  onSave,
  onDiscard,
}: SaveBarProps) {
  const reduce = useReducedMotion();
  const visible = count > 0 || saving;

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          role="region"
          aria-label="Unsaved changes"
          initial={{ opacity: 0, y: reduce ? 0 : 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : 12 }}
          transition={{ duration: reduce ? 0.1 : 0.22, ease: [0.2, 0, 0, 1] }}
          className="sticky bottom-4 z-20 mt-6"
        >
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-popover/95 px-4 py-3 shadow-2xl shadow-background backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <div
              aria-live="polite"
              className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm"
            >
              <span className="flex items-center gap-2 text-foreground">
                <span aria-hidden className="size-1.5 rounded-full bg-amber-400" />
                <span>
                  <span className="font-mono font-medium tabular-nums">{count}</span> unsaved{' '}
                  {count === 1 ? 'change' : 'changes'} in{' '}
                  <span className="font-medium">{sectionLabel}</span>
                </span>
              </span>
              {errorCount > 0 ? (
                <span className="flex items-center gap-1.5 text-destructive">
                  <CircleAlert aria-hidden className="size-3.5" />
                  Fix {errorCount} {errorCount === 1 ? 'field' : 'fields'} to save
                </span>
              ) : otherSections > 0 ? (
                <span className="text-muted-foreground">
                  + {otherSections} other {otherSections === 1 ? 'section' : 'sections'} pending
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving}>
                Discard
              </Button>
              <Button
                size="sm"
                aria-label="Save changes"
                aria-keyshortcuts="Control+s Meta+s"
                onClick={onSave}
                disabled={saving || errorCount > 0}
                className="gap-2"
              >
                {saving ? <Spinner /> : null}
                {saving ? 'Saving…' : 'Save changes'}
                {!saving ? (
                  <Kbd
                    aria-hidden="true"
                    className="hidden bg-primary-foreground/10 text-primary-foreground sm:inline-flex"
                  >
                    ⌘S
                  </Kbd>
                ) : null}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
