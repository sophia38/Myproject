import dayjs from 'dayjs';
import { http } from 'msw/http';
import { CRM_API } from '@/lib/api/config';
import type { WaitlistWindow } from '@/lib/api/types';
import { WAITLIST_REASON_MAX } from '@/lib/api/waitlist';
import { findAppointment, present } from '../appointmentState';
import { getDb, saveDb, visiblePractices } from '../store';
import { fail, forbidden, ok, paginate, unauthorized } from '../respond';
import {
  addToWaitingList,
  approveDecision,
  cancellationCounts,
  isWaiting,
  offerFirstInLine,
  offerSlot,
  presentCancelRequest,
  presentSlot,
  presentWaitlistEntry,
  recordReply,
  rejectDecision,
  releaseSlot,
  skipPatient,
  suggestionsFor,
  waitlistFor,
  waitlistSettingsFor,
} from '../waitlistState';

// Cancellations and waiting list mocks (sprint 16). No backend exists yet; paths are inferred.

const practicePath = (path: string) => `*${CRM_API}/public/v1/sub-apps/:subAppId/practices/:practiceId/${path}`;

function guard(practiceId: string) {
  if (!getDb().session.signedIn) return unauthorized();
  if (!visiblePractices().some((practice) => practice.id === practiceId)) return forbidden();
  return null;
}

type Outcome = { slot: unknown; message: string } | { error: string; status?: number };
const respond = (outcome: Outcome) =>
  'error' in outcome ? fail(outcome.status ?? 400, outcome.error) : ok(outcome.slot, outcome.message);

export const waitlistHandlers = [
  http.get(practicePath('released-slots/'), ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const search = query.get('search')?.trim().toLowerCase();
    const staffId = query.get('staff_id');
    const status = query.get('status');
    const rows = waitlistFor(practiceId)
      .slots.map((slot) => presentSlot(practiceId, slot))
      .filter((slot) => !staffId || slot.staff.id === staffId)
      .filter((slot) => !status || slot.status === status)
      .filter(
        (slot) =>
          !search ||
          slot.patient_name.toLowerCase().includes(search) ||
          slot.request_name.toLowerCase().includes(search),
      )
      // Newest cancellation first (brief).
      .sort((a, b) => b.cancelled_at.localeCompare(a.cancelled_at));
    return ok(paginate(request, rows));
  }),

  http.get(practicePath('released-slots/summary/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const slots = waitlistFor(practiceId).slots;
    const weekAgo = dayjs().subtract(7, 'day');
    return ok({
      released_this_week: slots.filter((slot) => dayjs(slot.cancelled_at).isAfter(weekAgo)).length,
      needs_offer: slots.filter((slot) => slot.status === 'NEEDS_OFFER').length,
      awaiting_approval: slots.filter((slot) => slot.status === 'AWAITING_APPROVAL').length,
      offers_held: slots.filter((slot) => slot.status === 'OFFERED').length,
      first_to_accept: slots.filter((slot) => slot.status === 'FIRST_TO_ACCEPT').length,
      refilled: slots.filter((slot) => slot.status === 'BOOKED').length,
    });
  }),

  http.get(practicePath('released-slots/:slotId/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const slot = waitlistFor(practiceId).slots.find((item) => item.id === params.slotId);
    return slot ? ok(presentSlot(practiceId, slot)) : fail(404, 'Slot not found');
  }),

  http.get(practicePath('released-slots/:slotId/suggestions/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const slot = waitlistFor(practiceId).slots.find((item) => item.id === params.slotId);
    return slot ? ok(suggestionsFor(practiceId, slot)) : fail(404, 'Slot not found');
  }),

  http.post(practicePath('released-slots/:slotId/offer/'), async ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const body = (await request.json()) as { patient_id?: string; book_directly?: boolean };
    if (!body.patient_id) return fail(400, 'Choose a patient');
    return respond(offerSlot(practiceId, String(params.slotId), body.patient_id, Boolean(body.book_directly)));
  }),

  http.post(practicePath('released-slots/:slotId/offer-first-in-line/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    return guard(practiceId) ?? respond(offerFirstInLine(practiceId, String(params.slotId)));
  }),

  http.post(practicePath('released-slots/:slotId/skip/'), async ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const body = (await request.json()) as { patient_id?: string };
    return respond(skipPatient(practiceId, String(params.slotId), String(body.patient_id ?? '')));
  }),

  http.post(practicePath('released-slots/:slotId/approve/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    return guard(practiceId) ?? respond(approveDecision(practiceId, String(params.slotId)));
  }),

  http.post(practicePath('released-slots/:slotId/reject/'), async ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const reason = String(((await request.json()) as { reason?: string }).reason ?? '').trim();
    if (!reason) return fail(400, 'Reason is required', [{ field: 'reason', message: 'Reason is required' }]);
    return respond(rejectDecision(practiceId, String(params.slotId), reason));
  }),

  http.post(practicePath('released-slots/:slotId/reply/'), async ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const body = (await request.json()) as { patient_id?: string; reply?: 'ACCEPTED' | 'DECLINED' };
    if (body.reply !== 'ACCEPTED' && body.reply !== 'DECLINED') return fail(400, 'Choose Accepted or Declined');
    return respond(recordReply(practiceId, String(params.slotId), String(body.patient_id ?? ''), body.reply));
  }),

  http.get(practicePath('waiting-list/'), ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const search = query.get('search')?.trim().toLowerCase();
    const window = query.get('window');
    const status = query.get('status');
    const rows = waitlistFor(practiceId)
      .waitlist.map((entry) => presentWaitlistEntry(practiceId, entry))
      .filter((entry) => !window || entry.window === window)
      .filter((entry) => !status || entry.status === status)
      .filter((entry) => !search || entry.patient_name.toLowerCase().includes(search))
      // 1-week list first, oldest first: the order offers follow.
      .sort((a, b) => a.window.localeCompare(b.window) || a.added_at.localeCompare(b.added_at));
    return ok(paginate(request, rows));
  }),

  http.post(practicePath('waiting-list/'), async ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const body = (await request.json()) as { patient_id?: string; window?: WaitlistWindow; reason?: string };
    const reason = String(body.reason ?? '').trim();
    const errors = [
      ...(!body.patient_id ? [{ field: 'patient_id', message: 'Patient is required' }] : []),
      ...(!body.window ? [{ field: 'window', message: 'Due window is required' }] : []),
      ...(!reason ? [{ field: 'reason', message: 'Reason is required' }] : []),
      ...(reason.length > WAITLIST_REASON_MAX
        ? [{ field: 'reason', message: `Reason must be ${WAITLIST_REASON_MAX} characters or fewer` }]
        : []),
    ];
    if (errors.length) return fail(400, errors[0].message, errors);
    if (isWaiting(practiceId, String(body.patient_id))) {
      return fail(400, 'This patient is already on the waiting list.', [
        { field: 'patient_id', message: 'This patient is already on the waiting list.' },
      ]);
    }
    return ok(
      addToWaitingList(practiceId, String(body.patient_id), body.window as WaitlistWindow, reason),
      'Added to the waiting list',
    );
  }),

  http.get(practicePath('cancel-requests/'), ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const status = new URL(request.url).searchParams.get('status');
    const rows = waitlistFor(practiceId)
      .cancelRequests.map((item) => presentCancelRequest(practiceId, item))
      .filter((item) => !status || item.status === status)
      .sort((a, b) => b.received_at.localeCompare(a.received_at));
    return ok(paginate(request, rows));
  }),

  ...(['cancel', 'keep'] as const).map((action) =>
    http.post(practicePath(`cancel-requests/:requestId/${action}/`), ({ params }) => {
      const practiceId = String(params.practiceId);
      const denied = guard(practiceId);
      if (denied) return denied;
      const item = waitlistFor(practiceId).cancelRequests.find((entry) => entry.id === params.requestId);
      if (!item) return fail(404, 'Request not found');
      if (item.status !== 'NEW') return fail(400, 'This request has already been dealt with.');
      if (action === 'keep') {
        item.status = 'KEPT';
        saveDb();
        return ok(presentCancelRequest(practiceId, item), 'Marked as kept');
      }
      const seed = findAppointment(practiceId, item.appointment_id);
      const shown = seed ? present(seed) : null;
      if (!seed || !shown || (shown.status !== 'UPCOMING' && shown.status !== 'RESCHEDULE_REQUESTED')) {
        return fail(400, 'This appointment can no longer be cancelled.');
      }
      getDb().appointmentChanges[`${practiceId}:${seed.id}`] = {
        status: 'CANCELLED_BY_PATIENT',
        reason: 'Replied CANCEL to the appointment reminder',
      };
      item.status = 'CANCELLED';
      releaseSlot(practiceId, shown, 'REMINDER_REPLY', 'Replied CANCEL to the appointment reminder');
      saveDb();
      return ok(presentCancelRequest(practiceId, item), 'Appointment cancelled. The slot is in Cancelled Appointments');
    }),
  ),

  http.get(practicePath('cancellation-counts/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const settings = waitlistSettingsFor(practiceId);
    return ok({
      counts: cancellationCounts(practiceId),
      warning: settings.frequent_canceller_warning,
      threshold: settings.frequent_canceller_threshold,
      months: settings.frequent_canceller_months,
    });
  }),
];
