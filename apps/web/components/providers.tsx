'use client';

import { MotionConfig } from 'motion/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SWRConfig } from 'swr';

import { ThemeProvider } from '@/components/theme-provider';
import { ThemeStyles } from '@/components/theme-styles';
import { Toaster } from '@/components/ui/sonner';
import { apiFetch } from '@/lib/api';
import { useSettings } from '@/lib/hooks';
function RuntimeMotion({ children }: { children: React.ReactNode }) {
  const { data } = useSettings();
  return (
    <MotionConfig
      reducedMotion={
        (data as any)?.experience?.appearance?.motion === 'reduced' ? 'always' : 'user'
      }
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
    >
      {children}
    </MotionConfig>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      storageKey="harbor-theme-v2"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={300}>
        <SWRConfig
          value={{
            fetcher: (path: string) => apiFetch<unknown>(path),
            shouldRetryOnError: false,
            revalidateOnFocus: false,
            dedupingInterval: 2000,
          }}
        >
          <RuntimeMotion>{children}</RuntimeMotion>
          <ThemeStyles />
          <Toaster position="bottom-right" closeButton />
        </SWRConfig>
      </TooltipProvider>
    </ThemeProvider>
  );
}
