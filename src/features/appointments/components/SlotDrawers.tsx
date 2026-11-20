'use client';

import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { useSnackbar } from 'notistack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { CancellationMarker, type CancellationMarkerProps } from '@/components/data/CancellationMarker';
import { LabelValueList } from '@/components/data/LabelValueList';
import { StatusChip } from '@/components/data/StatusChip';
import { LoadingSpinner } from '@/components/feedback/LoadingSpinner';
import { FormDrawer } from '@/components/modals/FormDrawer';
import { APPOINTMENT_KIND_LABELS } from '@/lib/api/appointments';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import type { ReleasedSlot, SlotSuggestion, WaitlistEntry } from '@/lib/api/types';
import { SLOT_STATUS_LABELS, WAITLIST_WINDOW_LABELS, waitlistApi } from '@/lib/api/waitlist';

export const slotWhen = (slot: Pick<ReleasedSlot, 'date' | 'start_time'>) =>
  `${dayjs(slot.date).format('ddd DD/MM/YYYY')} at ${slot.start_time}`;
const stamp = (iso: string) => dayjs(iso).format('DD/MM/YYYY HH:mm');

type MarkerFor = (patientId: string) => (Omit<CancellationMarkerProps, 'count'> & { count: number }) | null;

function Marker({ markerFor, patientId, count }: { markerFor: MarkerFor; patientId: string; count?: number }) {
  const props = markerFor(patientId);
  return props ? <CancellationMarker {...props} count={count ?? props.count} /> : null;
}

/**
 * Next in Line (sprint 16): waiting patients for a released slot, 1-week list first. Offer the top
 * patient, Skip to see the next one, or assign another patient (optionally booking directly when
 * they've agreed by phone). Within 24 hours the slot goes to the first patients in line instead.
 */
export function NextInLineDrawer({
  practiceId,
  slot,
  firstToAcceptCount,
  managerApproval,
  markerFor,
  onClose,
  onChanged,
}: {
  practiceId: string;
  slot: ReleasedSlot | null;
  firstToAcceptCount: number;
  managerApproval: boolean;
  markerFor: MarkerFor;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [suggestions, setSuggestions] = useState<SlotSuggestion[] | null>(null);
  const [waiting, setWaiting] = useState<WaitlistEntry[]>([]);
  const [chosen, setChosen] = useState('');
  const [direct, setDirect] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!slot) return;
    const controller = new AbortController();
    Promise.all([
      waitlistApi.suggestions(PUBLIC_SUB_APP_ID, practiceId, slot.id, controller.signal),
      waitlistApi.waitingList(PUBLIC_SUB_APP_ID, practiceId, { status: 'WAITING', page_size: 100 }, controller.signal),
    ])
      .then(([list, all]) => {
        setSuggestions(list);
        setWaiting(all.results.filter((entry) => entry.patient_id !== slot.patient_id));
      })
      .catch(() => {
        if (!controller.signal.aborted) enqueueSnackbar('Failed to load the waiting list', { variant: 'error' });
      });
    return () => controller.abort();
  }, [practiceId, slot, reload, enqueueSnackbar]);

  const run = async (call: () => Promise<ReleasedSlot>, done: (saved: ReleasedSlot) => string, failed: string) => {
    setBusy(true);
    try {
      const saved = await call();
      enqueueSnackbar(done(saved), { variant: 'success' });
      onChanged();
      if (saved.status === 'NEEDS_OFFER') setReload((value) => value + 1);
      else onClose();
    } catch {
      enqueueSnackbar(failed, { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!slot) return null;
  const offer = (patientId: string, name: string, bookDirectly = false) =>
    run(
      () => waitlistApi.offer(PUBLIC_SUB_APP_ID, practiceId, slot.id, patientId, bookDirectly),
      (saved) =>
        saved.status === 'AWAITING_APPROVAL'
          ? 'Sent to the practice manager for approval'
          : bookDirectly
            ? `Booked for ${name}`
            : `Offer sent to ${name}`,
      'Failed to offer the slot',
    );

  return (
    <FormDrawer open title="Next in Line" subtitle={`${slotWhen(slot)} · ${slot.staff.name}`} onClose={onClose}>
      <Stack spacing={2}>
        <LabelValueList
          dense
          items={[
            { label: 'Problem type', value: slot.request_name },
            { label: 'Appointment type', value: APPOINTMENT_KIND_LABELS[slot.type] },
            { label: 'Cancelled by', value: slot.patient_name },
          ]}
        />
        {slot.within_24h ? (
          <Alert severity="warning">
            Less than 24 hours away, so there’s no hold. The slot goes to the first {firstToAcceptCount} patients in
            line and the first to accept gets it.
          </Alert>
        ) : (
          <Alert severity="info">
            The patient you offer it to has a hold on the slot. If they decline or don’t reply in time, offer it to the
            next patient.
            {managerApproval && ' Practice manager approval is on, so the offer goes out once it’s approved.'}
          </Alert>
        )}
        {slot.offers.some((item) => item.state !== 'OPEN') && (
          <Alert severity="info" icon={false}>
            {slot.offers
              .filter((item) => item.state !== 'OPEN')
              .map(
                (item) =>
                  `${item.patient_name}: ${item.state === 'DECLINED' ? 'declined' : item.state === 'EXPIRED' ? 'didn’t reply in time' : item.state.toLowerCase()}`,
              )
              .join(' · ')}
          </Alert>
        )}

        <Typography variant="subtitle2">Suggested patients</Typography>
        {suggestions === null ? (
          <LoadingSpinner message="Loading the waiting list..." />
        ) : suggestions.length === 0 ? (
          <Typography variant="body2">Nobody is waiting for this slot. Leave it open for normal booking.</Typography>
        ) : (
          <Stack spacing={1.25} component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {suggestions.map((entry, index) => (
              <Box
                key={entry.id}
                component="li"
                sx={(theme) => ({
                  border: `1px solid ${index === 0 ? theme.palette.primary.main : theme.tokens.border.medium}`,
                  bgcolor: index === 0 ? theme.tokens.surface.tealLight : 'transparent',
                  borderRadius: `${theme.tokens.radius.input}px`,
                  p: 1.5,
                  display: 'flex',
                  gap: 1.5,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                })}
              >
                <Box sx={{ flex: 1, minWidth: 180 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography sx={{ fontWeight: 500 }}>{entry.patient_name}</Typography>
                    <Marker markerFor={markerFor} patientId={entry.patient_id} count={entry.cancellation_count} />
                  </Stack>
                  <Typography variant="caption">
                    {WAITLIST_WINDOW_LABELS[entry.window]} · {entry.reason} · waiting since{' '}
                    {dayjs(entry.added_at).format('DD/MM/YYYY')}
                    {entry.fallback && ' · from the 2-week list'}
                  </Typography>
                </Box>
                {!slot.within_24h && (
                  <Stack direction="row" spacing={1}>
                    {index === 0 && (
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () => waitlistApi.skip(PUBLIC_SUB_APP_ID, practiceId, slot.id, entry.patient_id),
                            () => `Skipped ${entry.patient_name}. Showing the next patient`,
                            'Failed to skip the patient',
                          )
                        }
                      >
                        Skip
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant={index === 0 ? 'contained' : 'outlined'}
                      disabled={busy}
                      onClick={() => offer(entry.patient_id, entry.patient_name)}
                    >
                      Offer
                    </Button>
                  </Stack>
                )}
              </Box>
            ))}
          </Stack>
        )}
        {slot.within_24h && Boolean(suggestions?.length) && (
          <Button
            variant="contained"
            disabled={busy}
            onClick={() =>
              run(
                () => waitlistApi.offerFirstInLine(PUBLIC_SUB_APP_ID, practiceId, slot.id),
                (saved) => `Offer sent to ${saved.offers.filter((item) => item.state === 'OPEN').length} patients`,
                'Failed to offer the slot',
              )
            }
          >
            Offer to First {Math.min(firstToAcceptCount, suggestions?.length ?? 0)} in Line
          </Button>
        )}

        <Divider />
        <Typography variant="subtitle2">Assign another patient</Typography>
        <TextField
          select
          label="Patient on the waiting list"
          value={chosen}
          onChange={(event) => setChosen(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          disabled={!waiting.length}
          helperText={waiting.length ? undefined : 'Nobody else is waiting.'}
        >
          {waiting.map((entry) => (
            <MenuItem key={entry.id} value={entry.patient_id}>
              {entry.patient_name} · {WAITLIST_WINDOW_LABELS[entry.window]}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Checkbox checked={direct} onChange={(event) => setDirect(event.target.checked)} />}
          label="Book directly: the patient has agreed by phone"
        />
        <Button
          variant="outlined"
          disabled={!chosen || busy}
          onClick={() => {
            const entry = waiting.find((item) => item.patient_id === chosen);
            if (entry) void offer(entry.patient_id, entry.patient_name, direct);
          }}
          sx={{ alignSelf: 'flex-start' }}
        >
          {direct ? 'Book Patient' : 'Offer to Patient'}
        </Button>
      </Stack>
    </FormDrawer>
  );
}

/**
 * Released slot details (sprint 16): what happened to the slot, open offers with the patient's reply
 * (recorded by staff until replies come from the patient app), and Approve or Reject when the
 * practice manager's approval is waiting.
 */
export function SlotDetailsDrawer({
  practiceId,
  slot,
  markerFor,
  onClose,
  onChanged,
  onOffer,
  onApprove,
  onReject,
}: {
  practiceId: string;
  slot: ReleasedSlot | null;
  markerFor: MarkerFor;
  onClose: () => void;
  onChanged: (slot: ReleasedSlot) => void;
  onOffer: (slot: ReleasedSlot) => void;
  onApprove: (slot: ReleasedSlot) => void;
  onReject: (slot: ReleasedSlot) => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [busy, setBusy] = useState(false);
  if (!slot) return null;

  const reply = async (patientId: string, name: string, answer: 'ACCEPTED' | 'DECLINED') => {
    setBusy(true);
    try {
      const saved = await waitlistApi.recordReply(PUBLIC_SUB_APP_ID, practiceId, slot.id, patientId, answer);
      enqueueSnackbar(answer === 'ACCEPTED' ? `Booked for ${name}` : `${name} declined. Offer it to the next patient`, {
        variant: 'success',
      });
      onChanged(saved);
    } catch {
      enqueueSnackbar('Failed to record the reply', { variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const open = slot.offers.filter((item) => item.state === 'OPEN');

  return (
    <FormDrawer open title="Released Slot" subtitle={`${slotWhen(slot)} · ${slot.staff.name}`} onClose={onClose}>
      <Stack spacing={2.5}>
        <LabelValueList
          items={[
            {
              label: 'Cancelled by',
              value: (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                  <span>{slot.patient_name}</span>
                  <Marker markerFor={markerFor} patientId={slot.patient_id} count={slot.cancellation_count} />
                </Stack>
              ),
            },
            { label: 'Problem type', value: slot.request_name },
            { label: 'Appointment type', value: APPOINTMENT_KIND_LABELS[slot.type] },
            {
              label: 'Cancelled',
              value: `${stamp(slot.cancelled_at)} · ${slot.source === 'REMINDER_REPLY' ? 'reply to reminder' : 'patient asked'}`,
            },
            { label: 'Reason', value: slot.reason || 'No reason given' },
            {
              label: 'Status',
              value: <StatusChip status={SLOT_STATUS_LABELS[slot.status]} tone={slotTone(slot.status)} />,
            },
          ]}
        />

        {slot.status === 'NEEDS_OFFER' && (
          <Button variant="contained" onClick={() => onOffer(slot)} sx={{ alignSelf: 'flex-start' }}>
            Offer Slot
          </Button>
        )}
        {slot.status === 'AWAITING_APPROVAL' && slot.pending_decision && (
          <Alert severity="info">
            {slot.pending_decision.by} wants to {slot.pending_decision.type === 'BOOK' ? 'book' : 'offer it to'}{' '}
            {slot.pending_decision.patient_name}.
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button size="small" variant="contained" onClick={() => onApprove(slot)}>
                Approve
              </Button>
              <Button size="small" variant="outlined" color="error" onClick={() => onReject(slot)}>
                Reject
              </Button>
            </Stack>
          </Alert>
        )}
        {open.length > 0 && (
          <Stack spacing={1.25}>
            <Typography variant="subtitle2">Patient replies</Typography>
            <Typography variant="caption">
              Record the reply when the patient answers by phone or text. Replies from the patient app will arrive here
              on their own.
            </Typography>
            {open.map((item) => (
              <Box
                key={item.patient_id}
                sx={(theme) => ({
                  border: `1px solid ${theme.tokens.border.medium}`,
                  borderRadius: `${theme.tokens.radius.input}px`,
                  p: 1.5,
                  display: 'flex',
                  gap: 1,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                })}
              >
                <Box sx={{ flex: 1, minWidth: 160 }}>
                  <Typography sx={{ fontWeight: 500 }}>{item.patient_name}</Typography>
                  <Typography variant="caption">
                    {item.hold_until
                      ? `Held until ${dayjs(item.hold_until).format('DD/MM/YYYY HH:mm')}`
                      : 'First to accept gets it'}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy}
                  onClick={() => reply(item.patient_id, item.patient_name, 'DECLINED')}
                >
                  Declined
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy}
                  onClick={() => reply(item.patient_id, item.patient_name, 'ACCEPTED')}
                >
                  Accepted
                </Button>
              </Box>
            ))}
          </Stack>
        )}

        <Box>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            History
          </Typography>
          <Stack component="ol" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {slot.history
              .slice()
              .reverse()
              .map((entry, index) => (
                <Box
                  key={`${entry.at}-${index}`}
                  component="li"
                  sx={(theme) => ({ borderLeft: `2px solid ${theme.tokens.border.medium}`, pl: 1.5 })}
                >
                  <Typography variant="body2" sx={{ color: 'text.primary' }}>
                    {entry.text}
                  </Typography>
                  <Typography variant="caption">
                    {stamp(entry.at)} · {entry.by}
                  </Typography>
                </Box>
              ))}
          </Stack>
        </Box>
      </Stack>
    </FormDrawer>
  );
}

export function slotTone(status: ReleasedSlot['status']) {
  return (
    {
      NEEDS_OFFER: 'warning',
      AWAITING_APPROVAL: 'secondary',
      OFFERED: 'info',
      FIRST_TO_ACCEPT: 'secondary',
      BOOKED: 'success',
      NOT_FILLED: 'neutral',
    } as const
  )[status];
}
