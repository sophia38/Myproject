'use client';

import { useCallback, useState } from 'react';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useSnackbar } from 'notistack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { CancellationMarker } from '@/components/data/CancellationMarker';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { StatusChip } from '@/components/data/StatusChip';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { patientPath } from '@/features/patients/patientsRoutes';
import { useCurrentPractice, usePracticeHref } from '@/features/practice/PracticeContext';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import type { CancelRequest, CancelRequestListParams } from '@/lib/api/types';
import { CANCEL_REQUEST_STATUS_LABELS, waitlistApi } from '@/lib/api/waitlist';
import { usePagedList, type PagedFetcher } from '@/lib/usePagedList';
import { useCancellationCounts } from './useCancellationCounts';

/**
 * Cancel Requests (sprint 16, brief F5): patients who replied CANCEL to an appointment reminder. A
 * reply doesn't cancel on its own: staff check it, then Cancel Appointment releases the slot to the
 * waiting list (Cancelled Appointments), or Keep marks it as kept.
 */
export function CancelRequestsTab() {
  const practice = useCurrentPractice();
  const practiceHref = usePracticeHref();
  const { enqueueSnackbar } = useSnackbar();
  const [deciding, setDeciding] = useState<{ request: CancelRequest; action: 'cancel' | 'keep' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [changes, setChanges] = useState(0);
  const markerFor = useCancellationCounts(practice.id, changes);

  const fetcher = useCallback<PagedFetcher<CancelRequest>>(
    (params, signal) =>
      waitlistApi.cancelRequests(PUBLIC_SUB_APP_ID, practice.id, params as CancelRequestListParams, signal),
    [practice.id],
  );
  const list = usePagedList(fetcher, {
    pageSize: 10,
    errorText: 'Could not load cancel requests.',
    errorToast: 'Failed to load cancel requests',
  });

  const decide = async () => {
    if (!deciding) return;
    const { request, action } = deciding;
    setBusy(true);
    try {
      if (action === 'cancel') await waitlistApi.cancelFromRequest(PUBLIC_SUB_APP_ID, practice.id, request.id);
      else await waitlistApi.keepFromRequest(PUBLIC_SUB_APP_ID, practice.id, request.id);
      enqueueSnackbar(
        action === 'cancel' ? 'Appointment cancelled. The slot is in Cancelled Appointments' : 'Marked as kept',
        { variant: 'success' },
      );
      setDeciding(null);
      list.reload();
      setChanges((value) => value + 1);
    } catch {
      enqueueSnackbar(action === 'cancel' ? 'Failed to cancel the appointment' : 'Failed to update the request', {
        variant: 'error',
      });
    } finally {
      setBusy(false);
    }
  };

  const columns: DataTableColumn<CancelRequest>[] = [
    {
      id: 'patient',
      label: 'Patient Name',
      render: (request) => {
        const marker = markerFor(request.patient_id);
        return (
          <Box sx={{ minWidth: 150 }}>
            <Box
              component={Link}
              href={practiceHref(patientPath(request.patient_id))}
              sx={{ color: 'text.primary', fontWeight: 500 }}
            >
              {request.patient_name}
            </Box>
            {marker && (
              <Box sx={{ mt: 0.5 }}>
                <CancellationMarker {...marker} count={request.cancellation_count} />
              </Box>
            )}
          </Box>
        );
      },
    },
    {
      id: 'appointment',
      label: 'Appointment',
      render: (request) => (
        <Box sx={{ minWidth: 170 }}>
          {dayjs(request.date).format('DD/MM/YYYY')} {request.start_time}
          <Typography variant="caption" sx={{ display: 'block' }}>
            {request.staff_name} · {request.request_name}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'received',
      label: 'Received',
      render: (request) => (
        <Box sx={{ whiteSpace: 'nowrap' }}>{dayjs(request.received_at).format('DD/MM/YYYY HH:mm')}</Box>
      ),
    },
    {
      id: 'reply',
      label: 'Reply',
      render: (request) => (
        <Box>
          <Box component="span" sx={{ fontWeight: 600 }}>
            “{request.message}”
          </Box>
          <Typography variant="caption" sx={{ display: 'block' }}>
            SMS reply to the reminder
          </Typography>
        </Box>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      render: (request) => (
        <StatusChip
          status={CANCEL_REQUEST_STATUS_LABELS[request.status]}
          tone={request.status === 'NEW' ? 'warning' : request.status === 'CANCELLED' ? 'success' : 'neutral'}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      align: 'center',
      render: (request) =>
        request.status === 'NEW' ? (
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
            <Button
              size="small"
              variant="outlined"
              color="error"
              onClick={() => setDeciding({ request, action: 'cancel' })}
            >
              Cancel Appointment
            </Button>
            <Button size="small" variant="outlined" onClick={() => setDeciding({ request, action: 'keep' })}>
              Keep
            </Button>
          </Stack>
        ) : (
          '-'
        ),
    },
  ];

  const target = deciding?.request;
  const when = target ? `${dayjs(target.date).format('DD/MM/YYYY')} at ${target.start_time}` : '';

  return (
    <Stack spacing={2.5}>
      <FilterBar
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All Status',
            options: (Object.keys(CANCEL_REQUEST_STATUS_LABELS) as CancelRequest['status'][]).map((status) => ({
              value: status,
              label: CANCEL_REQUEST_STATUS_LABELS[status],
            })),
          },
        ]}
        values={list.query.filters}
        onChange={list.setFilter}
        onClear={list.clear}
      />
      <DataTable
        aria-label="Cancel requests"
        columns={columns}
        rows={list.rows}
        getRowId={(request) => request.id}
        page={list.query.page}
        rowsPerPage={list.query.pageSize}
        totalCount={list.count}
        onPageChange={list.setPage}
        onRowsPerPageChange={list.setPageSize}
        loading={list.loading}
        error={list.error}
        emptyMessage="No cancel requests found."
        minWidth={950}
      />
      {deciding && target && (
        <ConfirmDialog
          open
          title={deciding.action === 'cancel' ? 'Cancel Appointment' : 'Keep Appointment'}
          message={
            deciding.action === 'cancel'
              ? `Cancel ${target.patient_name}'s appointment on ${when}? The slot is released to the waiting list.`
              : `Keep ${target.patient_name}'s appointment on ${when}? Use this when the patient has confirmed they’re still coming.`
          }
          confirmButtonText={deciding.action === 'cancel' ? 'Cancel Appointment' : 'Keep Appointment'}
          cancelButtonText="Back"
          confirmButtonVariant={deciding.action === 'cancel' ? 'error' : 'primary'}
          confirmButtonLoading={busy}
          onClose={() => setDeciding(null)}
          onConfirm={decide}
        />
      )}
    </Stack>
  );
}
