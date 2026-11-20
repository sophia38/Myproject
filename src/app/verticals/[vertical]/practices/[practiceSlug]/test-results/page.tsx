import { Suspense } from 'react';
import { TestResultsPage } from '@/features/clinical/TestResultsPage';

export default function Page() {
  // The tab is kept in `?tab=`.
  return (
    <Suspense>
      <TestResultsPage />
    </Suspense>
  );
}
