'use client';

import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useSnackbar } from 'notistack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlineOutlined';
import EventAvailable from '@mui/icons-material/EventAvailableOutlined';
import PendingActions from '@mui/icons-material/PendingActionsOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { StatsStrip } from '@/components/data/StatsStrip';
import { StatusChip } from '@/components/data/StatusChip';
import { ModulePageHeader } from '@/components/layout/ModulePageHeader';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { patientPath } from '@/features/patients/patientsRoutes';
import { useCurrentPractice, usePracticeCrumbs, usePracticeHref } from '@/features/practice/PracticeContext';
import { useAssignableStaff } from '@/features/tickets/components/AssignStaffModal';
import { ticketPath } from '@/features/tickets/ticketsRoutes';
import { clinicalApi, HOME_VISIT_WINDOW_LABELS } from '@/lib/api/clinical';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import type { HomeVisit, HomeVisitListParams, HomeVisitRequest, HomeVisitSummary } from '@/lib/api/types';
import { usePagedList, type PagedFetcher } from '@/lib/usePagedList';

/**
 * Home Visits (sprint 16, docs/plans/sprint-16-modules.md §6): booked visits by date and clinician,
 * and the consultations still waiting for one (booked from Consultation Details).
 */
export function HomeVisitsPage() {
  const theme = useTheme();
  const practice = useCurrentPractice();
  const practiceHref = usePracticeHref();
  const { enqueueSnackbar } = useSnackbar();
  const staff = useAssignableStaff(practice.id);
  const [summary, setSummary] = useState<HomeVisitSummary | null>(null);
  const [waiting, setWaiting] = useState<HomeVisitRequest[]>([]);
  const [changes, setChanges] = useState(0);
  const [completing, setCompleting] = useState<HomeVisit | null>(null);
  const [busy, setBusy] = useState(false);
  usePracticeCrumbs([{ label: 'Home Visits' }]);

  const fetcher = useCallback<PagedFetcher<HomeVisit>>(
    (params, signal) => clinicalApi.homeVisits(PUBLIC_SUB_APP_ID, practice.id, params as HomeVisitListParams, signal),
    [practice.id],
  );
  const list = usePagedList(fetcher, {
    pageSize: 10,
    errorText: 'Could not load home visits.',
    errorToast: 'Failed to load home visits',
  });

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      clinicalApi.homeVisitSummary(PUBLIC_SUB_APP_ID, practice.id, controller.signal),
      clinicalApi.homeVisitRequests(PUBLIC_SUB_APP_ID, practice.id, controller.signal),
    ])
      .then(([totals, requests]) => {
        setSummary(totals);
        setWaiting(requests.filter((request) => !request.visit));
      })
      .catch(() => {
        if (!controller.signal.aborted) enqueueSnackbar('Failed to load home visit requests', { variant: 'error' });
      });
    return () => controller.abort();
  }, [practice.id, changes, enqueueSnackbar]);

  const complete = async () => {
    if (!completing) return;
    setBusy(true);
    try {
      await clinicalApi.completeHomeVisit(PUBLIC_SUB_APP_ID, practice.id, completing.id);
      enqueueSnackbar('Home visit marked as completed', { variant: 'success' });
      setCompleting(null);
      list.reload();
      setChanges((value) => value + 1);
    } catch {
      enqueueSnackbar('Failed to update the home visit', { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const columns: DataTableColumn<HomeVisit>[] = [
    {
      id: 'date',
      label: 'Date',
      render: (visit) => (
        <Box sx={{ whiteSpace: 'nowrap' }}>
          {dayjs(visit.date).format('ddd DD/MM/YYYY')}
          <Typography variant="caption" sx={{ display: 'block' }}>
            {HOME_VISIT_WINDOW_LABELS[visit.window]}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'patient',
      label: 'Patient Name',
      render: (visit) => (
        <Box
          component={Link}
          href={practiceHref(patientPath(visit.patient_id))}
          sx={{ color: 'text.primary', fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          {visit.patient_name}
        </Box>
      ),
    },
    { id: 'address', label: 'Address', render: (visit) => <Box sx={{ minWidth: 160 }}>{visit.address || '-'}</Box> },
    {
      id: 'clinician',
      label: 'Clinician',
      render: (visit) => (
        <Box sx={{ minWidth: 110 }}>
          {visit.clinician.name}
          <Typography variant="caption" sx={{ display: 'block' }}>
            {visit.clinician.role}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'reason',
      label: 'Reason',
      render: (visit) => (
        <Box sx={{ minWidth: 140, maxWidth: 220 }}>
          {visit.reason}
          {visit.notes && (
            <Typography variant="caption" sx={{ display: 'block' }}>
              {visit.notes}
            </Typography>
          )}
        </Box>
      ),
    },
    {
      id: 'status',
      label: 'Status',
      render: (visit) => (
        <StatusChip
          status={visit.status === 'BOOKED' ? 'Booked' : 'Completed'}
          tone={visit.status === 'BOOKED' ? 'info' : 'success'}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      align: 'center',
      render: (visit) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'center', alignItems: 'center' }}>
          {visit.status === 'BOOKED' && (
            <Button size="small" variant="outlined" onClick={() => setCompleting(visit)} sx={{ whiteSpace: 'nowrap' }}>
              Mark Completed
            </Button>
          )}
          {visit.ticket_id && (
            <Tooltip title="View consultation">
              <IconButton
                component={Link}
                href={practiceHref(ticketPath(visit.ticket_id))}
                aria-label={`View consultation for ${visit.patient_name}`}
                size="small"
                sx={{ color: 'primary.main' }}
              >
                <VisibilityOutlined fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      ),
    },
  ];

  const { tone } = theme.tokens;
  const filtered = Boolean(list.query.search) || Object.values(list.query.filters).some(Boolean);

  return (
    <Stack spacing={2.5}>
      <ModulePageHeader title="Home Visits" subtitle="Booked home visits by date and clinician." />
      <StatsStrip
        variant="pill"
        items={[
          {
            label: 'Requests to Book',
            value: summary?.requests_to_book ?? 0,
            color: tone.warning.main,
            tint: tone.warning.strongBg,
            icon: <PendingActions />,
          },
          {
            label: 'Booked',
            value: summary?.booked ?? 0,
            color: tone.info.main,
            tint: tone.info.strongBg,
            icon: <EventAvailable />,
          },
          {
            label: 'Completed',
            value: summary?.completed ?? 0,
            color: tone.success.main,
            tint: tone.success.strongBg,
            icon: <CheckCircleOutline />,
          },
        ]}
      />
      {waiting.length > 0 && (
        <Alert severity="warning">
          <Typography variant="subtitle2" sx={{ color: 'inherit' }}>
            Waiting to be booked
          </Typography>
          <Stack component="ul" spacing={0.5} sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
            {waiting.map((request) => (
              <li key={request.ticket_id}>
                {request.patient_name} · {request.reason} ·{' '}
                <Box component={Link} href={practiceHref(ticketPath(request.ticket_id))} sx={{ color: 'inherit' }}>
                  Open consultation to book
                </Box>
              </li>
            ))}
          </Stack>
        </Alert>
      )}
      <FilterBar
        filters={[
          {
            id: 'status',
            label: 'Status',
            allLabel: 'All Status',
            options: [
              { value: 'BOOKED', label: 'Booked' },
              { value: 'COMPLETED', label: 'Completed' },
            ],
          },
          {
            id: 'staff_id',
            label: 'Clinician',
            allLabel: 'All Clinicians',
            options: (staff ?? []).map((member) => ({ value: member.id, label: member.name })),
          },
        ]}
        values={list.query.filters}
        onChange={list.setFilter}
        search={{ value: list.query.search, onChange: list.setSearch, placeholder: 'Search patient or address' }}
        onClear={list.clear}
      />
      <DataTable
        aria-label="Home visits"
        columns={columns}
        rows={list.rows}
        getRowId={(visit) => visit.id}
        page={list.query.page}
        rowsPerPage={list.query.pageSize}
        totalCount={list.count}
        onPageChange={list.setPage}
        onRowsPerPageChange={list.setPageSize}
        loading={list.loading}
        error={list.error}
        emptyMessage={filtered ? 'No home visits found. Try another search.' : 'No home visits booked yet.'}
        minWidth={950}
      />
      {completing && (
        <ConfirmDialog
          open
          title="Mark as Completed"
          message={`Record ${completing.patient_name}'s home visit on ${dayjs(completing.date).format('DD/MM/YYYY')} as completed?`}
          confirmButtonText="Mark as Completed"
          confirmButtonVariant="success"
          confirmButtonLoading={busy}
          onClose={() => setCompleting(null)}
          onConfirm={complete}
        />
      )}
    </Stack>
  );
}
