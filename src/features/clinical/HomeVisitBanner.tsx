'use client';

import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import Link from 'next/link';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import { StatusChip } from '@/components/data/StatusChip';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import { usePracticeHref } from '@/features/practice/PracticeContext';
import { clinicalApi, HOME_VISIT_WINDOW_LABELS } from '@/lib/api/clinical';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import type { HomeVisitRequest, TicketStaff } from '@/lib/api/types';
import { BookHomeVisitModal } from './BookHomeVisitModal';

export const HOME_VISITS_PATH = '/home-visits';

/** The practice's home visit requests by consultation id (for the Tickets marker and the banner). */
export function useHomeVisitRequests(practiceId: string) {
  const [requests, setRequests] = useState<Map<string, HomeVisitRequest>>(new Map());
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    clinicalApi
      .homeVisitRequests(PUBLIC_SUB_APP_ID, practiceId, controller.signal)
      .then((list) => setRequests(new Map(list.map((request) => [request.ticket_id, request]))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [practiceId, reloadKey]);
  const reload = useCallback(() => setReloadKey((value) => value + 1), []);
  return { requests, reload };
}

/**
 * "Home visit needed" banner on Consultation Details (sprint 16): the patient's reason and Book Home
 * Visit; once booked, the visit's date, window and clinician.
 */
export function HomeVisitBanner({
  practiceId,
  ticketId,
  preferred,
  readOnly,
}: {
  practiceId: string;
  ticketId: string;
  preferred: TicketStaff | null;
  readOnly: boolean;
}) {
  const practiceHref = usePracticeHref();
  const { requests, reload } = useHomeVisitRequests(practiceId);
  const [booking, setBooking] = useState(false);
  const request = requests.get(ticketId);
  if (!request) return null;

  if (request.visit) {
    const { visit } = request;
    return (
      <Alert severity="success" icon={<HomeOutlined />} sx={{ mb: 2.5 }}>
        <AlertTitle>Home visit booked</AlertTitle>
        {dayjs(visit.date).format('ddd DD/MM/YYYY')} · {HOME_VISIT_WINDOW_LABELS[visit.window]} · {visit.clinician.name}
        {visit.status === 'COMPLETED' && ' · Completed'}.{' '}
        <Box component={Link} href={practiceHref(HOME_VISITS_PATH)} sx={{ color: 'inherit' }}>
          View Home Visits
        </Box>
      </Alert>
    );
  }

  return (
    <>
      <Alert
        severity="warning"
        icon={<HomeOutlined />}
        sx={{ mb: 2.5, '& .MuiAlert-action': { alignItems: 'center' } }}
        action={
          readOnly ? undefined : (
            <Button variant="contained" size="small" onClick={() => setBooking(true)} sx={{ whiteSpace: 'nowrap' }}>
              Book Home Visit
            </Button>
          )
        }
      >
        <AlertTitle>Home visit needed</AlertTitle>
        The patient said: {request.reason}. They confirmed none of the “usually not a home visit” reasons apply.
      </Alert>
      <BookHomeVisitModal
        open={booking}
        practiceId={practiceId}
        request={request}
        preferred={preferred}
        onClose={() => setBooking(false)}
        onBooked={() => {
          setBooking(false);
          reload();
        }}
      />
    </>
  );
}

/** "Home visit" marker next to the patient name on Tickets, with the patient's reason on hover. */
export function HomeVisitMarker({ request }: { request: HomeVisitRequest | undefined }) {
  if (!request) return null;
  const label = request.visit ? 'Home visit booked' : 'Home visit';
  const detail = `${request.visit ? 'Home visit booked' : 'The patient asked for a home visit'}: ${request.reason}`;
  return (
    <Tooltip title={detail}>
      <Box component="span" tabIndex={0} aria-label={detail} sx={{ display: 'inline-flex', ml: 0.75 }}>
        <StatusChip
          status={label}
          tone={request.visit ? 'success' : 'secondary'}
          variant="outlined"
          icon={<HomeOutlined />}
        />
      </Box>
    </Tooltip>
  );
}
