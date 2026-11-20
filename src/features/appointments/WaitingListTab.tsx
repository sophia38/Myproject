'use client';

import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Formik } from 'formik';
import Link from 'next/link';
import { useSnackbar } from 'notistack';
import * as Yup from 'yup';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddCircleOutline from '@mui/icons-material/AddCircleOutlineOutlined';
import { CancellationMarker } from '@/components/data/CancellationMarker';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { StatusChip } from '@/components/data/StatusChip';
import { FormModal } from '@/components/modals/FormModal';
import { patientPath } from '@/features/patients/patientsRoutes';
import { useCurrentPractice, usePracticeHref } from '@/features/practice/PracticeContext';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import { patientName, patientsApi } from '@/lib/api/patients';
import type { Patient, WaitlistEntry, WaitlistListParams, WaitlistStatus, WaitlistWindow } from '@/lib/api/types';
import { WAITLIST_REASON_MAX, WAITLIST_STATUS_LABELS, WAITLIST_WINDOW_LABELS, waitlistApi } from '@/lib/api/waitlist';
import { usePagedList, type PagedFetcher } from '@/lib/usePagedList';
import { useCancellationCounts } from './useCancellationCounts';

interface Values {
  patient_id: string;
  window: WaitlistWindow | '';
  reason: string;
}

const schema = Yup.object({
  patient_id: Yup.string().required('Patient is required'),
  window: Yup.string().required('Due window is required'),
  reason: Yup.string()
    .trim()
    .required('Reason is required')
    .max(WAITLIST_REASON_MAX, `Reason must be ${WAITLIST_REASON_MAX} characters or fewer`),
});

function AddToWaitingListModal({
  open,
  practiceId,
  onClose,
  onSaved,
}: {
  open: boolean;
  practiceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [patients, setPatients] = useState<Patient[]>([]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    patientsApi
      .list(PUBLIC_SUB_APP_ID, practiceId, { page: 1, page_size: 100 }, controller.signal)
      .then((page) => setPatients(page.results.filter((patient) => !patient.archived)))
      .catch(() => {
        if (!controller.signal.aborted) enqueueSnackbar('Failed to load patients', { variant: 'error' });
      });
    return () => controller.abort();
  }, [open, practiceId, enqueueSnackbar]);

  return (
    <Formik<Values>
      key={open ? 'open' : 'closed'}
      initialValues={{ patient_id: '', window: '', reason: '' }}
      validationSchema={schema}
      validateOnMount
      onSubmit={async (values, helpers) => {
        try {
          await waitlistApi.addToWaitingList(PUBLIC_SUB_APP_ID, practiceId, {
            patient_id: values.patient_id,
            window: values.window as WaitlistWindow,
            reason: values.reason.trim(),
          });
          enqueueSnackbar('Added to the waiting list', { variant: 'success' });
          onSaved();
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (message.includes('already on the waiting list')) {
            helpers.setFieldError('patient_id', 'This patient is already on the waiting list.');
          } else {
            enqueueSnackbar('Failed to add to the waiting list', { variant: 'error' });
          }
        }
      }}
    >
      {(formik) => (
        <FormModal
          open={open}
          title="Add to Waiting List"
          subtitle="A routine appointment to book within 1 or 2 weeks. Freed slots go to the 1-week list first."
          onClose={onClose}
          onSubmit={formik.submitForm}
          submitLabel="Add to Waiting List"
          submitIcon={<AddCircleOutline />}
          submitDisabled={!formik.isValid}
          submitting={formik.isSubmitting}
        >
          <TextField
            select
            fullWidth
            required
            label="Patient"
            {...formik.getFieldProps('patient_id')}
            error={formik.touched.patient_id && Boolean(formik.errors.patient_id)}
            helperText={formik.touched.patient_id && formik.errors.patient_id}
          >
            {patients.map((patient) => (
              <MenuItem key={patient.id} value={patient.id}>
                {patientName(patient)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            fullWidth
            required
            label="Due window"
            {...formik.getFieldProps('window')}
            error={formik.touched.window && Boolean(formik.errors.window)}
            helperText={formik.touched.window && formik.errors.window}
          >
            {(Object.keys(WAITLIST_WINDOW_LABELS) as WaitlistWindow[]).map((window) => (
              <MenuItem key={window} value={window}>
                {WAITLIST_WINDOW_LABELS[window]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            fullWidth
            required
            label="Reason"
            placeholder="e.g. Asthma review"
            {...formik.getFieldProps('reason')}
            slotProps={{ htmlInput: { maxLength: WAITLIST_REASON_MAX } }}
            error={formik.touched.reason && Boolean(formik.errors.reason)}
            helperText={formik.touched.reason && formik.errors.reason}
          />
        </FormModal>
      )}
    </Formik>
  );
}

/**
 * Waiting List (sprint 16): routine appointments to book within 1 or 2 weeks. The order here is the
 * order patients are suggested for released slots (1-week list first, oldest first).
 */
export function WaitingListTab() {
  const practice = useCurrentPractice();
  const practiceHref = usePracticeHref();
  const [adding, setAdding] = useState(false);
  const fetcher = useCallback<PagedFetcher<WaitlistEntry>>(
    (params, signal) => waitlistApi.waitingList(PUBLIC_SUB_APP_ID, practice.id, params as WaitlistListParams, signal),
    [practice.id],
  );
  const list = usePagedList(fetcher, {
    pageSize: 10,
    errorText: 'Could not load the waiting list.',
    errorToast: 'Failed to load the waiting list',
  });
  const markerFor = useCancellationCounts(practice.id);

  const columns: DataTableColumn<WaitlistEntry>[] = [
    {
      id: 'patient',
      label: 'Patient Name',
      render: (entry) => {
        const marker = markerFor(entry.patient_id);
        return (
          <Box sx={{ minWidth: 150 }}>
            <Box
              component={Link}
              href={practiceHref(patientPath(entry.patient_id))}
              sx={{ color: 'text.primary', fontWeight: 500 }}
            >
              {entry.patient_name}
            </Box>
            {marker && (
              <Box sx={{ mt: 0.5 }}>
                <CancellationMarker {...marker} count={entry.cancellation_count} />
              </Box>
            )}
          </Box>
        );
      },
    },
    {
      id: 'window',
      label: 'Due Window',
      render: (entry) => (
        <StatusChip
          status={WAITLIST_WINDOW_LABELS[entry.window]}
          tone={entry.window === 'ONE_WEEK' ? 'primary' : 'neutral'}
        />
      ),
    },
    { id: 'reason', label: 'Reason', render: (entry) => <Box sx={{ minWidth: 140 }}>{entry.reason}</Box> },
    { id: 'added', label: 'Added', render: (entry) => dayjs(entry.added_at).format('DD/MM/YYYY') },
    {
      id: 'due',
      label: 'Due By',
      render: (entry) => (
        <Box
          sx={{
            whiteSpace: 'nowrap',
            color: entry.status === 'WAITING' && dayjs(entry.due_by).isBefore(dayjs()) ? 'error.main' : 'text.primary',
          }}
        >
          {dayjs(entry.due_by).format('DD/MM/YYYY')}
        </Box>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      render: (entry) => (
        <StatusChip
          status={WAITLIST_STATUS_LABELS[entry.status]}
          tone={entry.status === 'BOOKED' ? 'success' : entry.status === 'OFFERED' ? 'info' : 'neutral'}
        />
      ),
    },
  ];

  const filtered = Boolean(list.query.search) || Object.values(list.query.filters).some(Boolean);

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
        <Button variant="contained" startIcon={<AddCircleOutline />} onClick={() => setAdding(true)}>
          Add to Waiting List
        </Button>
      </Stack>
      <FilterBar
        filters={[
          {
            id: 'window',
            label: 'Due Window',
            allLabel: 'All',
            options: (Object.keys(WAITLIST_WINDOW_LABELS) as WaitlistWindow[]).map((window) => ({
              value: window,
              label: WAITLIST_WINDOW_LABELS[window],
            })),
          },
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All Status',
            options: (Object.keys(WAITLIST_STATUS_LABELS) as WaitlistStatus[]).map((status) => ({
              value: status,
              label: WAITLIST_STATUS_LABELS[status],
            })),
          },
        ]}
        values={list.query.filters}
        onChange={list.setFilter}
        search={{ value: list.query.search, onChange: list.setSearch, placeholder: 'Search patient' }}
        onClear={list.clear}
      />
      <DataTable
        aria-label="Waiting list"
        columns={columns}
        rows={list.rows}
        getRowId={(entry) => entry.id}
        page={list.query.page}
        rowsPerPage={list.query.pageSize}
        totalCount={list.count}
        onPageChange={list.setPage}
        onRowsPerPageChange={list.setPageSize}
        loading={list.loading}
        error={list.error}
        emptyMessage={filtered ? 'No patients found. Try another search.' : 'Nobody is on the waiting list.'}
        minWidth={850}
      />
      <Typography variant="caption">
        Released slots are suggested to the “within 1 week” list first, oldest first, then the “within 2 weeks” list
        when the practice allows it.
      </Typography>
      <AddToWaitingListModal
        open={adding}
        practiceId={practice.id}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          list.reload();
        }}
      />
    </Stack>
  );
}
