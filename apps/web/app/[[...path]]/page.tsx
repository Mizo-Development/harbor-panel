import { Suspense } from 'react';
import { Harbor } from '@/components/harbor';
export default function Page() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-muted-foreground">Loading Harbor…</div>}>
      <Harbor />
    </Suspense>
  );
}
