'use client';

import { useCallback, useEffect, useState } from 'react';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import { waitlistApi } from '@/lib/api/waitlist';

type Counts = { counts: Record<string, number>; warning: number; threshold: number; months: number };

/**
 * The practice's frequent-canceller counts (staff only), for the markers on the patient list,
 * patient profile and cancellation tables. A failed load just hides the markers.
 */
export function useCancellationCounts(practiceId: string, reloadKey: unknown = 0) {
  const [data, setData] = useState<Counts | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    waitlistApi
      .cancellationCounts(PUBLIC_SUB_APP_ID, practiceId, controller.signal)
      .then(setData)
      .catch(() => undefined);
    return () => controller.abort();
  }, [practiceId, reloadKey]);

  /** Props for `<CancellationMarker>`, or null while loading. */
  const markerFor = useCallback(
    (patientId: string) =>
      data
        ? { count: data.counts[patientId] ?? 0, warning: data.warning, threshold: data.threshold, months: data.months }
        : null,
    [data],
  );

  return markerFor;
}
