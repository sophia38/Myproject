'use client';

import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useSnackbar } from 'notistack';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutlineOutlined';
import EventBusy from '@mui/icons-material/EventBusyOutlined';
import HourglassEmpty from '@mui/icons-material/HourglassEmptyOutlined';
import PendingActions from '@mui/icons-material/PendingActionsOutlined';
import PeopleOutline from '@mui/icons-material/PeopleOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import { CancellationMarker } from '@/components/data/CancellationMarker';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { StatsStrip } from '@/components/data/StatsStrip';
import { StatusChip } from '@/components/data/StatusChip';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { patientPath } from '@/features/patients/patientsRoutes';
import { useCurrentPractice, usePracticeHref } from '@/features/practice/PracticeContext';
import { useAssignableStaff } from '@/features/tickets/components/AssignStaffModal';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import { practiceSettingsApi } from '@/lib/api/settings';
import type { ReleasedSlot, ReleasedSlotListParams, ReleasedSlotStatus, ReleasedSlotSummary } from '@/lib/api/types';
import { SLOT_STATUS_LABELS, WAITLIST_REASON_MAX, WAITLIST_SETTINGS_DEFAULTS, waitlistApi } from '@/lib/api/waitlist';
import { usePagedList, type PagedFetcher } from '@/lib/usePagedList';
import { NextInLineDrawer, SlotDetailsDrawer, slotTone } from './components/SlotDrawers';
import { useCancellationCounts } from './useCancellationCounts';

/** The second line under the slot status. */
function statusDetail(slot: ReleasedSlot) {
  const open = slot.offers.filter((offer) => offer.state === 'OPEN');
  const last = slot.offers[slot.offers.length - 1];
  switch (slot.status) {
    case 'NEEDS_OFFER': {
      const before =
        last && last.state !== 'OPEN' && last.state !== 'ACCEPTED'
          ? `${last.patient_name} ${last.state === 'DECLINED' ? 'declined' : 'didn’t reply'} · `
          : '';
      return `${before}${slot.next_in_line ? `Next in line: ${slot.next_in_line}` : 'Nobody waiting'}`;
    }
    case 'AWAITING_APPROVAL':
      return slot.pending_decision
        ? `${slot.pending_decision.type === 'BOOK' ? 'Book' : 'Offer to'} ${slot.pending_decision.patient_name} · chosen by ${slot.pending_decision.by}`
        : '';
    case 'OFFERED':
      return open[0]?.hold_until
        ? `${open[0].patient_name} · held until ${dayjs(open[0].hold_until).format('HH:mm')}`
        : (open[0]?.patient_name ?? '');
    case 'FIRST_TO_ACCEPT':
      return `Offered to ${open.length} patient${open.length === 1 ? '' : 's'} (within 24 h)`;
    case 'BOOKED':
      return slot.booked_patient_name ?? '';
    default:
      return 'The appointment time passed';
  }
}

/**
 * Cancelled Appointments (sprint 16, docs/plans/sprint-16-modules.md §5): slots released by patient
 * cancellations, newest first. Offer Slot opens Next in Line; offers wait for the practice manager
 * when approval is on (Practice Settings → Appointment Configuration → Waitlist Offers).
 */
export function CancelledAppointmentsTab() {
  const theme = useTheme();
  const practice = useCurrentPractice();
  const practiceHref = usePracticeHref();
  const { enqueueSnackbar } = useSnackbar();
  const staff = useAssignableStaff(practice.id);
  const [summary, setSummary] = useState<ReleasedSlotSummary | null>(null);
  const [changes, setChanges] = useState(0);
  const markerFor = useCancellationCounts(practice.id, changes);
  const [settings, setSettings] = useState(WAITLIST_SETTINGS_DEFAULTS);
  const [offering, setOffering] = useState<ReleasedSlot | null>(null);
  const [viewing, setViewing] = useState<ReleasedSlot | null>(null);
  const [deciding, setDeciding] = useState<{ slot: ReleasedSlot; action: 'approve' | 'reject' } | null>(null);
  const [busy, setBusy] = useState(false);

  const fetcher = useCallback<PagedFetcher<ReleasedSlot>>(
    (params, signal) => waitlistApi.slots(PUBLIC_SUB_APP_ID, practice.id, params as ReleasedSlotListParams, signal),
    [practice.id],
  );
  const list = usePagedList(fetcher, {
    pageSize: 10,
    errorText: 'Could not load cancelled appointments.',
    errorToast: 'Failed to load cancelled appointments',
  });
  const { reload } = list;

  useEffect(() => {
    const controller = new AbortController();
    waitlistApi
      .slotSummary(PUBLIC_SUB_APP_ID, practice.id, controller.signal)
      .then(setSummary)
      .catch(() => {
        if (!controller.signal.aborted) enqueueSnackbar('Failed to load slot totals', { variant: 'error' });
      });
    practiceSettingsApi
      .appointmentConfiguration(PUBLIC_SUB_APP_ID, practice.id, controller.signal)
      .then((config) => setSettings({ ...WAITLIST_SETTINGS_DEFAULTS, ...config }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [practice.id, changes, enqueueSnackbar]);

  const changed = useCallback(() => {
    reload();
    setChanges((value) => value + 1);
  }, [reload]);

  const decide = async (reason?: string) => {
    if (!deciding) return;
    const { slot, action } = deciding;
    setBusy(true);
    try {
      const saved =
        action === 'approve'
          ? await waitlistApi.approve(PUBLIC_SUB_APP_ID, practice.id, slot.id)
          : await waitlistApi.reject(PUBLIC_SUB_APP_ID, practice.id, slot.id, reason ?? '');
      const name = slot.pending_decision?.patient_name ?? '';
      enqueueSnackbar(
        action === 'reject'
          ? 'Rejected. The slot can be offered again'
          : saved.status === 'BOOKED'
            ? `Approved. Booked for ${name}`
            : `Approved. Offer sent to ${name}`,
        { variant: 'success' },
      );
      setDeciding(null);
      if (viewing) setViewing(saved);
      changed();
    } catch {
      enqueueSnackbar(action === 'approve' ? 'Failed to approve' : 'Failed to reject', { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const patientCell = (slot: ReleasedSlot) => {
    const marker = markerFor(slot.patient_id);
    return (
      <Box sx={{ minWidth: 130 }}>
        <Box
          component={Link}
          href={practiceHref(patientPath(slot.patient_id))}
          sx={{ color: 'text.primary', fontWeight: 500 }}
        >
          {slot.patient_name}
        </Box>
        {marker && (
          <Box sx={{ mt: 0.5 }}>
            <CancellationMarker {...marker} count={slot.cancellation_count} />
          </Box>
        )}
      </Box>
    );
  };

  const columns: DataTableColumn<ReleasedSlot>[] = [
    { id: 'patient', label: 'Patient Name', render: patientCell },
    {
      id: 'problem',
      label: 'Problem Type',
      render: (slot) => <Box sx={{ minWidth: 110, maxWidth: 160 }}>{slot.request_name}</Box>,
    },
    {
      id: 'time',
      label: 'Appointment',
      render: (slot) => (
        <Box sx={{ minWidth: 90 }}>
          {dayjs(slot.date).format('DD/MM/YYYY')}
          <Box component="span" sx={{ display: 'block' }}>
            {slot.start_time}
          </Box>
          {slot.within_24h && ['NEEDS_OFFER', 'FIRST_TO_ACCEPT'].includes(slot.status) && (
            <Typography variant="caption" sx={{ display: 'block', color: 'warning.dark' }}>
              Within 24 hours
            </Typography>
          )}
        </Box>
      ),
    },
    { id: 'gp', label: 'GP', render: (slot) => <Box sx={{ minWidth: 80 }}>{slot.staff.name}</Box> },
    {
      id: 'cancelled',
      label: 'Cancelled',
      render: (slot) => (
        <Box sx={{ whiteSpace: 'nowrap' }}>
          {dayjs(slot.cancelled_at).format('DD/MM/YYYY HH:mm')}
          <Typography variant="caption" sx={{ display: 'block' }}>
            {slot.source === 'REMINDER_REPLY' ? 'Reply to reminder' : 'Patient asked'}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', whiteSpace: 'normal', maxWidth: 180 }}>
            {slot.source === 'REMINDER_REPLY' ? '' : slot.reason ? `“${slot.reason}”` : 'No reason given'}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'status',
      label: 'Slot Status',
      render: (slot) => (
        <Box sx={{ minWidth: 130, maxWidth: 170 }}>
          <StatusChip status={SLOT_STATUS_LABELS[slot.status]} tone={slotTone(slot.status)} />
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
            {statusDetail(slot)}
          </Typography>
        </Box>
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      align: 'center',
      render: (slot) => (
        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'center', alignItems: 'center' }}>
          {slot.status === 'NEEDS_OFFER' && (
            <Button size="small" variant="contained" onClick={() => setOffering(slot)} sx={{ whiteSpace: 'nowrap' }}>
              Offer Slot
            </Button>
          )}
          {slot.status === 'AWAITING_APPROVAL' && (
            <>
              <Button size="small" variant="contained" onClick={() => setDeciding({ slot, action: 'approve' })}>
                Approve
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                onClick={() => setDeciding({ slot, action: 'reject' })}
              >
                Reject
              </Button>
            </>
          )}
          <Tooltip title="View slot">
            <IconButton
              aria-label={`View released slot for ${slot.patient_name}`}
              size="small"
              onClick={() => setViewing(slot)}
              sx={{ color: 'primary.main' }}
            >
              <VisibilityOutlined fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  const { tone } = theme.tokens;
  const filtered = Boolean(list.query.search) || Object.values(list.query.filters).some(Boolean);
  const target = deciding?.slot;

  return (
    <Stack spacing={2.5}>
      <StatsStrip
        variant="pill"
        items={[
          {
            label: 'Released This Week',
            value: summary?.released_this_week ?? 0,
            color: tone.warning.main,
            tint: tone.warning.strongBg,
            icon: <EventBusy />,
          },
          {
            label: 'Needs Offering',
            value: summary?.needs_offer ?? 0,
            color: tone.secondary.main,
            tint: tone.secondary.strongBg,
            icon: <PendingActions />,
          },
          {
            label: 'Awaiting Approval',
            value: summary?.awaiting_approval ?? 0,
            color: tone.info.main,
            tint: tone.info.strongBg,
            icon: <HourglassEmpty />,
          },
          {
            label: 'Offers Held',
            value: (summary?.offers_held ?? 0) + (summary?.first_to_accept ?? 0),
            color: tone.info.main,
            tint: tone.info.strongBg,
            icon: <PeopleOutline />,
          },
          {
            label: 'Refilled',
            value: summary?.refilled ?? 0,
            color: tone.success.main,
            tint: tone.success.strongBg,
            icon: <CheckCircleOutline />,
          },
        ]}
      />
      <FilterBar
        filters={[
          {
            id: 'staff_id',
            label: 'GP',
            allLabel: 'All GPs',
            options: (staff ?? []).map((member) => ({ value: member.id, label: member.name })),
          },
          {
            id: 'status',
            label: 'Slot Status',
            allLabel: 'All Status',
            options: (Object.keys(SLOT_STATUS_LABELS) as ReleasedSlotStatus[]).map((status) => ({
              value: status,
              label: SLOT_STATUS_LABELS[status],
            })),
          },
        ]}
        values={list.query.filters}
        onChange={list.setFilter}
        search={{ value: list.query.search, onChange: list.setSearch, placeholder: 'Search patient or problem' }}
        onClear={list.clear}
      />
      <DataTable
        aria-label="Cancelled appointments"
        columns={columns}
        rows={list.rows}
        getRowId={(slot) => slot.id}
        page={list.query.page}
        rowsPerPage={list.query.pageSize}
        totalCount={list.count}
        onPageChange={list.setPage}
        onRowsPerPageChange={list.setPageSize}
        loading={list.loading}
        error={list.error}
        emptyMessage={
          filtered ? 'No cancelled appointments found. Try another search.' : 'No cancelled appointments yet.'
        }
        minWidth={1000}
      />
      <Typography variant="caption">
        Practice manager approval is {settings.waitlist_manager_approval ? 'on' : 'off'}: offers more than 24 hours away{' '}
        {settings.waitlist_manager_approval
          ? 'wait for approval before they go to the patient'
          : 'go straight to the patient'}
        . Change it in Practice Settings → Appointment Configuration.
      </Typography>

      <NextInLineDrawer
        key={offering?.id ?? 'none'}
        practiceId={practice.id}
        slot={offering}
        firstToAcceptCount={settings.waitlist_first_to_accept_count}
        managerApproval={settings.waitlist_manager_approval}
        markerFor={markerFor}
        onClose={() => setOffering(null)}
        onChanged={changed}
      />
      <SlotDetailsDrawer
        practiceId={practice.id}
        slot={viewing}
        markerFor={markerFor}
        onClose={() => setViewing(null)}
        onChanged={(saved) => {
          setViewing(saved);
          changed();
        }}
        onOffer={(slot) => {
          setViewing(null);
          setOffering(slot);
        }}
        onApprove={(slot) => setDeciding({ slot, action: 'approve' })}
        onReject={(slot) => setDeciding({ slot, action: 'reject' })}
      />
      {deciding && target?.pending_decision && (
        <ConfirmDialog
          open
          title={deciding.action === 'approve' ? 'Approve Offer' : 'Reject Offer'}
          message={
            deciding.action === 'approve'
              ? `${target.pending_decision.type === 'BOOK' ? 'Book' : 'Offer'} ${dayjs(target.date).format('DD/MM/YYYY')} at ${target.start_time} ${target.pending_decision.type === 'BOOK' ? 'for' : 'to'} ${target.pending_decision.patient_name}, as ${target.pending_decision.by} chose?`
              : `Reject ${target.pending_decision.by}’s choice of ${target.pending_decision.patient_name}? The slot goes back to be offered again.`
          }
          confirmButtonText={deciding.action === 'approve' ? 'Approve' : 'Reject'}
          confirmButtonVariant={deciding.action === 'approve' ? 'success' : 'error'}
          requireReason={
            deciding.action === 'reject'
              ? {
                  label: 'Reason',
                  maxLength: WAITLIST_REASON_MAX,
                  required: true,
                  placeholder: 'Why is this rejected?',
                }
              : undefined
          }
          confirmButtonLoading={busy}
          onClose={() => setDeciding(null)}
          onConfirm={decide}
        />
      )}
    </Stack>
  );
}
