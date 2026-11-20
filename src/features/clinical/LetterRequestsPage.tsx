'use client';

import { useCallback, useState } from 'react';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useSnackbar } from 'notistack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import TaskAlt from '@mui/icons-material/TaskAltOutlined';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { StatusChip } from '@/components/data/StatusChip';
import { ModulePageHeader } from '@/components/layout/ModulePageHeader';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { FormModal } from '@/components/modals/FormModal';
import { patientPath } from '@/features/patients/patientsRoutes';
import { useCurrentPractice, usePracticeCrumbs, usePracticeHref } from '@/features/practice/PracticeContext';
import { CLINICAL_TEXT_MAX, clinicalApi, LETTER_STATUS_LABELS } from '@/lib/api/clinical';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import type { LetterListParams, LetterRequest, LetterStatus } from '@/lib/api/types';
import { usePagedList, type PagedFetcher } from '@/lib/usePagedList';

const STATUS_TONES: Record<LetterStatus, 'neutral' | 'warning' | 'info' | 'success' | 'error'> = {
  SENT: 'neutral',
  IN_PROGRESS: 'info',
  FEE_TO_CONFIRM: 'warning',
  READY: 'success',
  DECLINED: 'error',
};

type Action = { letter: LetterRequest; kind: 'ready' | 'fee' | 'decline' };

/**
 * Letter Requests (sprint 16, design brief F7): letters patients ask for in the app. Staff write the
 * letter, tell the patient about any fee for non-NHS letters, then upload it and mark it ready (or
 * decline with a reason the patient sees). Insurance reports are still parked.
 */
export function LetterRequestsPage() {
  const practice = useCurrentPractice();
  const practiceHref = usePracticeHref();
  const { enqueueSnackbar } = useSnackbar();
  const [action, setAction] = useState<Action | null>(null);
  const [fee, setFee] = useState('£25 · This letter isn’t an NHS service.');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  usePracticeCrumbs([{ label: 'Letter Requests' }]);

  const fetcher = useCallback<PagedFetcher<LetterRequest>>(
    (params, signal) => clinicalApi.letterRequests(PUBLIC_SUB_APP_ID, practice.id, params as LetterListParams, signal),
    [practice.id],
  );
  const list = usePagedList(fetcher, {
    pageSize: 10,
    errorText: 'Could not load letter requests.',
    errorToast: 'Failed to load letter requests',
  });

  const run = async (call: () => Promise<unknown>, done: string, failed: string) => {
    setBusy(true);
    try {
      await call();
      enqueueSnackbar(done, { variant: 'success' });
      setAction(null);
      list.reload();
    } catch {
      enqueueSnackbar(failed, { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const open = (letter: LetterRequest, kind: Action['kind']) => {
    setFile(null);
    setAction({ letter, kind });
  };

  const columns: DataTableColumn<LetterRequest>[] = [
    {
      id: 'patient',
      label: 'Patient Name',
      render: (letter) => (
        <Box
          component={Link}
          href={practiceHref(patientPath(letter.patient_id))}
          sx={{ color: 'text.primary', fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          {letter.patient_name}
        </Box>
      ),
    },
    {
      id: 'letter',
      label: 'Letter',
      render: (letter) => (
        <Box sx={{ minWidth: 180, maxWidth: 260 }}>
          {letter.type}
          <Typography variant="caption" sx={{ display: 'block' }}>
            {letter.purpose}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'needed',
      label: 'Needed By',
      render: (letter) => (letter.needed_by ? dayjs(letter.needed_by).format('DD/MM/YYYY') : '-'),
    },
    {
      id: 'delivery',
      label: 'Delivery',
      render: (letter) => (letter.delivery === 'IN_APP' ? 'In the app' : 'Collect from surgery'),
    },
    { id: 'received', label: 'Received', render: (letter) => dayjs(letter.received_at).format('DD/MM/YYYY') },
    {
      id: 'status',
      label: 'Status',
      render: (letter) => (
        <Box sx={{ minWidth: 120 }}>
          <StatusChip status={LETTER_STATUS_LABELS[letter.status]} tone={STATUS_TONES[letter.status]} />
          {(letter.fee || letter.decline_reason || letter.file_name) && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
              {letter.status === 'DECLINED'
                ? letter.decline_reason
                : letter.status === 'READY'
                  ? letter.file_name
                  : letter.fee}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      align: 'center',
      render: (letter) =>
        letter.status === 'READY' || letter.status === 'DECLINED' ? (
          '-'
        ) : (
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'center' }}>
            {letter.status === 'SENT' && (
              <Button
                size="small"
                variant="outlined"
                onClick={() =>
                  run(
                    () => clinicalApi.startLetter(PUBLIC_SUB_APP_ID, practice.id, letter.id),
                    'Letter request started',
                    'Failed to update the request',
                  )
                }
              >
                Start
              </Button>
            )}
            <Button
              size="small"
              variant="contained"
              onClick={() => open(letter, 'ready')}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Mark Ready
            </Button>
            <Button size="small" variant="outlined" onClick={() => open(letter, 'fee')}>
              Fee
            </Button>
            <Button size="small" variant="outlined" color="error" onClick={() => open(letter, 'decline')}>
              Decline
            </Button>
          </Stack>
        ),
    },
  ];

  const filtered = Boolean(list.query.search) || Object.values(list.query.filters).some(Boolean);
  const target = action?.letter;

  return (
    <Stack spacing={2.5}>
      <ModulePageHeader
        title="Letter Requests"
        subtitle="Letters patients ask for in the app. Write the letter, upload it and mark it ready."
      />
      <FilterBar
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All Status',
            options: (Object.keys(LETTER_STATUS_LABELS) as LetterStatus[]).map((status) => ({
              value: status,
              label: LETTER_STATUS_LABELS[status],
            })),
          },
        ]}
        values={list.query.filters}
        onChange={list.setFilter}
        search={{ value: list.query.search, onChange: list.setSearch, placeholder: 'Search patient or letter' }}
        onClear={list.clear}
      />
      <DataTable
        aria-label="Letter requests"
        columns={columns}
        rows={list.rows}
        getRowId={(letter) => letter.id}
        page={list.query.page}
        rowsPerPage={list.query.pageSize}
        totalCount={list.count}
        onPageChange={list.setPage}
        onRowsPerPageChange={list.setPageSize}
        loading={list.loading}
        error={list.error}
        emptyMessage={filtered ? 'No letter requests found. Try another search.' : 'No letter requests yet.'}
        minWidth={1000}
      />
      <Typography variant="caption">Insurance reports aren’t available yet.</Typography>

      {action?.kind === 'ready' && target && (
        <FormModal
          open
          title="Mark Letter Ready"
          subtitle={`${target.patient_name} · ${target.type}. The patient is told it’s ready.`}
          onClose={() => setAction(null)}
          onSubmit={() =>
            run(
              () => clinicalApi.letterReady(PUBLIC_SUB_APP_ID, practice.id, target.id, file?.name ?? ''),
              'Letter marked as ready',
              'Failed to mark the letter as ready',
            )
          }
          submitLabel="Mark Ready"
          submitIcon={<TaskAlt />}
          submitDisabled={!file}
          submitting={busy}
        >
          <Button variant="outlined" component="label" sx={{ alignSelf: 'flex-start' }}>
            Choose Letter (PDF)
            <input
              hidden
              type="file"
              accept="application/pdf"
              aria-label="Letter PDF"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Button>
          <Typography variant="body2">{file ? file.name : 'No file chosen. Upload the signed letter.'}</Typography>
          {target.delivery === 'COLLECT' && (
            <Typography variant="caption">The patient asked to collect it from the surgery.</Typography>
          )}
        </FormModal>
      )}
      {action?.kind === 'fee' && target && (
        <FormModal
          open
          title="Tell the Patient About a Fee"
          subtitle="Some letters aren’t NHS services. The patient must agree before you write it."
          onClose={() => setAction(null)}
          onSubmit={() =>
            run(
              () => clinicalApi.letterFee(PUBLIC_SUB_APP_ID, practice.id, target.id, fee.trim()),
              'Fee sent to the patient',
              'Failed to send the fee',
            )
          }
          submitLabel="Send to Patient"
          submitDisabled={!fee.trim()}
          submitting={busy}
        >
          <TextField
            fullWidth
            required
            label="Fee and message"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            slotProps={{ htmlInput: { maxLength: CLINICAL_TEXT_MAX } }}
            error={!fee.trim()}
            helperText={!fee.trim() ? 'Fee is required' : undefined}
          />
        </FormModal>
      )}
      {action?.kind === 'decline' && target && (
        <ConfirmDialog
          open
          title="Decline Request"
          message={`Decline ${target.patient_name}'s request for a ${target.type.toLowerCase()} letter? They see your reason.`}
          confirmButtonText="Decline Request"
          confirmButtonVariant="error"
          requireReason={{
            label: 'Reason',
            maxLength: CLINICAL_TEXT_MAX,
            required: true,
            placeholder: 'Why can’t the practice provide this letter?',
          }}
          confirmButtonLoading={busy}
          onClose={() => setAction(null)}
          onConfirm={(reason) =>
            run(
              () => clinicalApi.declineLetter(PUBLIC_SUB_APP_ID, practice.id, target.id, reason ?? ''),
              'Letter request declined',
              'Failed to decline the request',
            )
          }
        />
      )}
    </Stack>
  );
}
