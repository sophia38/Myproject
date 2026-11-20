import dayjs from 'dayjs';
import { patientName } from '@/lib/api/patients';
import type {
  Appointment,
  CancelledBy,
  CancelRequest,
  ReleasedSlot,
  SlotSuggestion,
  WaitlistEntry,
  WaitlistWindow,
} from '@/lib/api/types';
import { WAITLIST_SETTINGS_DEFAULTS, type WaitlistSettings } from '@/lib/api/waitlist';
import { appointmentsOn } from './fixtures/appointments';
import { mockId } from './fixtures/random';
import { changeKey, contextFor, findAppointment, present } from './appointmentState';
import { practiceSettingsFor } from './practiceSettingsState';
import { currentPersona, getDb, saveDb } from './store';

// Cancellations and automatic waitlist filling (sprint 16, docs/plans/sprint-16-modules.md §5).
// Seeded per practice the first time it's read: slots released by patient cancellations in the next
// week, a waiting list split into "within 1 week" and "within 2 weeks", a reply-CANCEL request, and
// earlier cancellations so some patients show the frequent-canceller marker. All data is fictional.

type SlotRecord = Omit<ReleasedSlot, 'cancellation_count' | 'within_24h' | 'next_in_line'> & {
  /** Patients skipped for this slot, so the next suggestion shows. */
  skipped: string[];
};
type WaitlistRecordEntry = Omit<WaitlistEntry, 'cancellation_count' | 'due_by'>;
type CancelRequestRecord = Omit<CancelRequest, 'cancellation_count'>;

export interface WaitlistRecord {
  slots: SlotRecord[];
  waitlist: WaitlistRecordEntry[];
  cancelRequests: CancelRequestRecord[];
  /** Patient id → dates of cancellations made before the demo (for the frequent-canceller count). */
  earlierCancellations: Record<string, string[]>;
}

const nowIso = () => dayjs().toISOString();
const actor = () => {
  const persona = currentPersona();
  return `${persona.firstName} ${persona.lastName}`;
};
const start = (slot: { date: string; start_time: string }) => dayjs(`${slot.date}T${slot.start_time}`);

export function waitlistSettingsFor(practiceId: string): WaitlistSettings {
  return { ...WAITLIST_SETTINGS_DEFAULTS, ...practiceSettingsFor(practiceId).appointment };
}

function patientLabel(practiceId: string, patientId: string) {
  const patient = getDb().patients.find((item) => item.id === patientId && item.practice_id === practiceId);
  return patient ? patientName(patient) : 'Unknown patient';
}

function slotFrom(appointment: Appointment, by: CancelledBy, source: SlotRecord['source'], reason: string | null) {
  const record: SlotRecord = {
    id: mockId(`slot:${appointment.practice_id}`, Date.now() % 1_000_000),
    practice_id: appointment.practice_id,
    appointment_id: appointment.id,
    patient_id: appointment.patient_id,
    patient_name: appointment.patient_name,
    request_name: appointment.request_name,
    staff: appointment.staff,
    type: appointment.type,
    date: appointment.date,
    start_time: appointment.start_time,
    end_time: appointment.end_time,
    cancelled_at: nowIso(),
    cancelled_by: by,
    source,
    reason,
    status: 'NEEDS_OFFER',
    offers: [],
    pending_decision: null,
    booked_patient_name: null,
    history: [],
    skipped: [],
  };
  return record;
}

/** The practice's upcoming appointments over the next `days` days, as shown. */
function upcoming(practiceId: string, days: number) {
  const context = contextFor(practiceId);
  if (!context) return [];
  return Array.from({ length: days }, (_, offset) => dayjs().add(offset, 'day').format('YYYY-MM-DD'))
    .flatMap((date) => appointmentsOn(context, date))
    .map((seed) => ({ seed, shown: present(seed) }));
}

function seedPractice(practiceId: string): WaitlistRecord {
  const db = getDb();
  const record: WaitlistRecord = { slots: [], waitlist: [], cancelRequests: [], earlierCancellations: {} };
  const next = upcoming(practiceId, 8);
  const later = next.filter(({ shown }) => shown.status === 'UPCOMING' && start(shown).isAfter(dayjs().add(1, 'hour')));
  const used = new Set<string>();

  // Patients the practice's tickets use, so names match the rest of the demo.
  const patients = db.patients.filter((item) => item.practice_id === practiceId && !item.archived);

  // 1) A slot released 2 days ago, more than 24 hours away: needs an offer.
  // 2) A slot within the next 24 hours: first to accept.
  // 3) A slot already refilled from the waiting list (history shows the steps).
  const beyond = later.filter(({ shown }) => start(shown).isAfter(dayjs().add(30, 'hour')));
  const soon = later.filter(({ shown }) => start(shown).isBefore(dayjs().add(22, 'hour')));
  // Each slot from a different patient.
  const pickFrom = (list: typeof later) => {
    const found = list.find(({ shown }) => !used.has(shown.id) && !used.has(shown.patient_id));
    if (found) {
      used.add(found.shown.id);
      used.add(found.shown.patient_id);
    }
    return found;
  };
  const first = pickFrom(beyond);
  const second = pickFrom(soon) ?? pickFrom(beyond);
  const third = pickFrom(beyond);
  const picks = [first, second, third].filter((item): item is NonNullable<typeof item> => Boolean(item));
  picks.forEach(({ seed, shown }, index) => {
    const reasons = ['Feeling better', '', 'Away that week'];
    const slot = slotFrom(shown, 'PATIENT', 'STAFF', reasons[index] || null);
    slot.id = mockId(`slot:${practiceId}`, index);
    slot.cancelled_at = dayjs()
      .subtract([2, 0, 3][index], 'day')
      .subtract(index * 37, 'minute')
      .toISOString();
    slot.history.push({
      at: slot.cancelled_at,
      by: 'Reception',
      text: `${shown.patient_name} phoned to cancel${slot.reason ? ` (“${slot.reason}”)` : ''}. Slot released.`,
    });
    db.appointmentChanges[changeKey(practiceId, seed.id)] = {
      status: 'CANCELLED_BY_PATIENT',
      reason: slot.reason ?? 'Patient cancelled',
    };
    record.slots.push(slot);
  });

  // Earlier cancellations: the first canceller is a frequent canceller (red), the second an early warning (amber).
  const cancellers = record.slots.map((slot) => slot.patient_id);
  const earlier = (patientId: string, count: number) => {
    record.earlierCancellations[patientId] = Array.from({ length: count }, (_, index) =>
      dayjs()
        .subtract(12 + index * 23, 'day')
        .toISOString(),
    );
  };
  if (cancellers[0]) earlier(cancellers[0], 5);
  if (cancellers[1]) earlier(cancellers[1], 2);

  // Waiting list: patients not in the cancelled slots.
  const waiting = patients.filter((item) => !used.has(item.id)).slice(0, 6);
  const windows: WaitlistWindow[] = ['ONE_WEEK', 'ONE_WEEK', 'ONE_WEEK', 'TWO_WEEKS', 'TWO_WEEKS', 'TWO_WEEKS'];
  const reasons = [
    'Back pain review',
    'Joint pain',
    'Skin rash',
    'Medication review',
    'Cough follow-up',
    'Blood pressure check',
  ];
  waiting.forEach((patient, index) => {
    record.waitlist.push({
      id: mockId(`waitlist:${practiceId}`, index),
      practice_id: practiceId,
      patient_id: patient.id,
      patient_name: patientName(patient),
      window: windows[index],
      reason: reasons[index],
      added_at: dayjs()
        .subtract(6 - index, 'day')
        .hour(9 + index)
        .minute(0)
        .toISOString(),
      status: 'WAITING',
    });
  });
  if (waiting[4]) earlier(waiting[4].id, 3);

  // The refilled slot was booked for the first 2-week patient.
  const refilled = record.slots[2];
  const taker = record.waitlist[3];
  if (refilled && taker) {
    const offeredAt = dayjs(refilled.cancelled_at).add(1, 'hour');
    refilled.offers.push({
      patient_id: taker.patient_id,
      patient_name: taker.patient_name,
      offered_at: offeredAt.toISOString(),
      hold_until: offeredAt.add(2, 'hour').toISOString(),
      state: 'ACCEPTED',
    });
    refilled.history.push(
      {
        at: offeredAt.subtract(5, 'minute').toISOString(),
        by: 'Jo Bennett',
        text: `Chose to offer it to ${taker.patient_name}.`,
      },
      { at: offeredAt.subtract(2, 'minute').toISOString(), by: 'Practice manager', text: 'Approved the offer.' },
      {
        at: offeredAt.add(40, 'minute').toISOString(),
        by: 'Jo Bennett',
        text: `${taker.patient_name} accepted. Appointment booked.`,
      },
    );
    bookInto(practiceId, refilled, taker.patient_id);
    taker.status = 'BOOKED';
  }

  // A patient replied CANCEL to the 48-hour reminder.
  const replied = later.find(
    ({ shown }) => !used.has(shown.id) && !used.has(shown.patient_id) && start(shown).isAfter(dayjs().add(26, 'hour')),
  );
  if (replied) {
    record.cancelRequests.push({
      id: mockId(`cancel-request:${practiceId}`, 0),
      practice_id: practiceId,
      appointment_id: replied.shown.id,
      patient_id: replied.shown.patient_id,
      patient_name: replied.shown.patient_name,
      staff_name: replied.shown.staff.name,
      request_name: replied.shown.request_name,
      date: replied.shown.date,
      start_time: replied.shown.start_time,
      received_at: dayjs().subtract(90, 'minute').toISOString(),
      message: 'CANCEL',
      status: 'NEW',
    });
  }
  return record;
}

export function waitlistFor(practiceId: string): WaitlistRecord {
  const db = getDb();
  if (!db.waitlist[practiceId]) {
    db.waitlist[practiceId] = seedPractice(practiceId);
    saveDb();
  }
  return refresh(practiceId, db.waitlist[practiceId]);
}

/** Offers past their hold expire; slots whose time has passed without a booking aren't filled. */
function refresh(practiceId: string, record: WaitlistRecord) {
  let changed = false;
  const now = dayjs();
  for (const slot of record.slots) {
    for (const offer of slot.offers) {
      if (offer.state === 'OPEN' && offer.hold_until && now.isAfter(offer.hold_until)) {
        offer.state = 'EXPIRED';
        setWaiting(record, offer.patient_id, 'WAITING');
        slot.status = 'NEEDS_OFFER';
        slot.history.push({
          at: offer.hold_until,
          by: 'System',
          text: `${offer.patient_name} didn’t reply in time. Offer expired.`,
        });
        changed = true;
      }
    }
    if (
      ['NEEDS_OFFER', 'AWAITING_APPROVAL', 'OFFERED', 'FIRST_TO_ACCEPT'].includes(slot.status) &&
      now.isAfter(start(slot))
    ) {
      slot.offers
        .filter((offer) => offer.state === 'OPEN')
        .forEach((offer) => {
          offer.state = 'EXPIRED';
          setWaiting(record, offer.patient_id, 'WAITING');
        });
      slot.status = 'NOT_FILLED';
      slot.pending_decision = null;
      slot.history.push({
        at: start(slot).toISOString(),
        by: 'System',
        text: 'The appointment time passed without the slot being filled.',
      });
      changed = true;
    }
  }
  if (changed) saveDb();
  return record;
}

function setWaiting(record: WaitlistRecord, patientId: string, status: WaitlistEntry['status']) {
  const entry = record.waitlist.find((item) => item.patient_id === patientId && item.status !== 'BOOKED');
  if (entry) entry.status = status;
}

/** Patient cancellations in the frequent-canceller period (staff only; never shown to patients). */
export function cancellationCount(practiceId: string, patientId: string) {
  const record = getDb().waitlist[practiceId];
  if (!record) return 0;
  const since = dayjs().subtract(waitlistSettingsFor(practiceId).frequent_canceller_months, 'month');
  const earlier = (record.earlierCancellations[patientId] ?? []).filter((at) => dayjs(at).isAfter(since)).length;
  const released = record.slots.filter(
    (slot) =>
      slot.patient_id === patientId && slot.cancelled_by === 'PATIENT' && dayjs(slot.cancelled_at).isAfter(since),
  ).length;
  return earlier + released;
}

export function cancellationCounts(practiceId: string) {
  const record = waitlistFor(practiceId);
  const ids = new Set([...Object.keys(record.earlierCancellations), ...record.slots.map((slot) => slot.patient_id)]);
  return Object.fromEntries([...ids].map((id) => [id, cancellationCount(practiceId, id)]).filter(([, count]) => count));
}

const openOfferPatients = (record: WaitlistRecord) =>
  new Set(
    record.slots.flatMap((slot) => [
      ...slot.offers.filter((offer) => offer.state === 'OPEN').map((offer) => offer.patient_id),
      ...(slot.pending_decision ? [slot.pending_decision.patient_id] : []),
    ]),
  );

export function presentWaitlistEntry(practiceId: string, entry: WaitlistRecordEntry): WaitlistEntry {
  return {
    ...entry,
    cancellation_count: cancellationCount(practiceId, entry.patient_id),
    due_by: dayjs(entry.added_at)
      .add(entry.window === 'ONE_WEEK' ? 7 : 14, 'day')
      .toISOString(),
  };
}

/** Waiting patients for a slot: 1-week list first (oldest first), then the 2-week list if fallback is on. */
export function suggestionsFor(practiceId: string, slot: SlotRecord): SlotSuggestion[] {
  const record = waitlistFor(practiceId);
  const settings = waitlistSettingsFor(practiceId);
  const excluded = new Set([...slot.skipped, ...slot.offers.map((offer) => offer.patient_id), slot.patient_id]);
  const busy = openOfferPatients(record);
  const waiting = record.waitlist
    .filter((entry) => entry.status === 'WAITING' && !excluded.has(entry.patient_id) && !busy.has(entry.patient_id))
    .sort((a, b) => a.added_at.localeCompare(b.added_at));
  const oneWeek = waiting.filter((entry) => entry.window === 'ONE_WEEK');
  const twoWeeks = settings.waitlist_two_week_fallback ? waiting.filter((entry) => entry.window === 'TWO_WEEKS') : [];
  return [
    ...oneWeek.map((entry) => ({ ...presentWaitlistEntry(practiceId, entry), fallback: false })),
    ...twoWeeks.map((entry) => ({ ...presentWaitlistEntry(practiceId, entry), fallback: true })),
  ];
}

export function presentSlot(practiceId: string, slot: SlotRecord): ReleasedSlot {
  const rest: Partial<SlotRecord> = { ...slot };
  delete rest.skipped;
  const next = slot.status === 'NEEDS_OFFER' ? suggestionsFor(practiceId, slot)[0] : undefined;
  return {
    ...(rest as Omit<SlotRecord, 'skipped'>),
    cancellation_count: cancellationCount(practiceId, slot.patient_id),
    within_24h: start(slot).diff(dayjs(), 'minute') < 24 * 60,
    next_in_line: next?.patient_name ?? null,
  };
}

/** Releases the slot of an appointment a patient cancelled (cancel dialog or a reply to a reminder). */
export function releaseSlot(
  practiceId: string,
  appointment: Appointment,
  source: SlotRecord['source'],
  reason: string | null,
) {
  const record = waitlistFor(practiceId);
  const slot = slotFrom(appointment, 'PATIENT', source, reason);
  slot.id = mockId(`slot:${practiceId}`, record.slots.length + (Date.now() % 100_000));
  slot.history.push({
    at: slot.cancelled_at,
    by: actor(),
    text:
      source === 'REMINDER_REPLY'
        ? `${appointment.patient_name} replied CANCEL to the reminder; ${actor()} cancelled it. Slot released.`
        : `${appointment.patient_name} asked to cancel${reason ? ` (“${reason}”)` : ''}. Slot released.`,
  });
  record.slots.unshift(slot);
  saveDb();
  return slot;
}

/** Books a slot for a waiting patient: the appointment becomes theirs (Appointment calendar and table). */
function bookInto(practiceId: string, slot: SlotRecord, patientId: string) {
  const db = getDb();
  const record = db.waitlist[practiceId];
  const seed = findAppointment(practiceId, slot.appointment_id);
  const patient = db.patients.find((item) => item.id === patientId);
  const entry = record?.waitlist.find((item) => item.patient_id === patientId);
  if (seed && patient) {
    db.appointmentChanges[changeKey(practiceId, seed.id)] = {
      status: 'UPCOMING',
      reason: null,
      rebooked: {
        patient_id: patient.id,
        patient_name: patientName(patient),
        patient_phone: patient.phone_number,
        patient_email: patient.email,
        request_name: entry?.reason ?? slot.request_name,
      },
    };
  }
  slot.status = 'BOOKED';
  slot.booked_patient_name = patientLabel(practiceId, patientId);
  slot.pending_decision = null;
  for (const offer of slot.offers) {
    if (offer.state === 'OPEN' && offer.patient_id !== patientId) {
      offer.state = 'TAKEN';
      if (record) setWaiting(record, offer.patient_id, 'WAITING');
    }
  }
  if (entry) entry.status = 'BOOKED';
}

function sendOffer(practiceId: string, record: WaitlistRecord, slot: SlotRecord, patientId: string) {
  const hours = waitlistSettingsFor(practiceId).waitlist_hold_hours;
  const holdUntil = dayjs().add(hours, 'hour');
  const latest = start(slot).subtract(30, 'minute');
  const until = holdUntil.isAfter(latest) ? latest : holdUntil;
  const name = patientLabel(practiceId, patientId);
  slot.offers.push({
    patient_id: patientId,
    patient_name: name,
    offered_at: nowIso(),
    hold_until: until.toISOString(),
    state: 'OPEN',
  });
  slot.status = 'OFFERED';
  slot.pending_decision = null;
  setWaiting(record, patientId, 'OFFERED');
  slot.history.push({ at: nowIso(), by: actor(), text: `Offer sent to ${name}, held until ${until.format('HH:mm')}.` });
}

type Result = { slot: ReleasedSlot; message: string } | { error: string; status?: number };

function withSlot(
  practiceId: string,
  slotId: string,
  run: (record: WaitlistRecord, slot: SlotRecord) => Result,
): Result {
  const record = waitlistFor(practiceId);
  const slot = record.slots.find((item) => item.id === slotId);
  if (!slot) return { error: 'Slot not found', status: 404 };
  const result = run(record, slot);
  saveDb();
  return result;
}

export function offerSlot(practiceId: string, slotId: string, patientId: string, bookDirectly: boolean): Result {
  return withSlot(practiceId, slotId, (record, slot) => {
    if (slot.status !== 'NEEDS_OFFER') return { error: 'This slot has already been offered or filled.' };
    const entry = record.waitlist.find((item) => item.patient_id === patientId && item.status === 'WAITING');
    if (!entry) return { error: 'This patient isn’t waiting, or already has an open offer.' };
    if (openOfferPatients(record).has(patientId)) return { error: 'This patient already has an open offer.' };
    const name = entry.patient_name;
    const settings = waitlistSettingsFor(practiceId);
    const within24 = start(slot).diff(dayjs(), 'minute') < 24 * 60;
    slot.history.push({
      at: nowIso(),
      by: actor(),
      text: bookDirectly ? `Chose to book ${name} directly (agreed by phone).` : `Chose to offer it to ${name}.`,
    });
    if (settings.waitlist_manager_approval && !within24) {
      slot.status = 'AWAITING_APPROVAL';
      slot.pending_decision = {
        type: bookDirectly ? 'BOOK' : 'OFFER',
        patient_id: patientId,
        patient_name: name,
        by: actor(),
        at: nowIso(),
      };
      return { slot: presentSlot(practiceId, slot), message: 'Sent to the practice manager for approval' };
    }
    if (bookDirectly) {
      bookInto(practiceId, slot, patientId);
      slot.history.push({ at: nowIso(), by: actor(), text: `Booked for ${name}.` });
      return { slot: presentSlot(practiceId, slot), message: `Booked for ${name}` };
    }
    sendOffer(practiceId, record, slot, patientId);
    return { slot: presentSlot(practiceId, slot), message: `Offer sent to ${name}` };
  });
}

export function offerFirstInLine(practiceId: string, slotId: string): Result {
  return withSlot(practiceId, slotId, (record, slot) => {
    if (slot.status !== 'NEEDS_OFFER') return { error: 'This slot has already been offered or filled.' };
    const count = waitlistSettingsFor(practiceId).waitlist_first_to_accept_count;
    const list = suggestionsFor(practiceId, slot).slice(0, count);
    if (!list.length) return { error: 'Nobody is waiting for this slot.' };
    for (const entry of list) {
      slot.offers.push({
        patient_id: entry.patient_id,
        patient_name: entry.patient_name,
        offered_at: nowIso(),
        hold_until: null,
        state: 'OPEN',
      });
      setWaiting(record, entry.patient_id, 'OFFERED');
    }
    slot.status = 'FIRST_TO_ACCEPT';
    slot.history.push({
      at: nowIso(),
      by: actor(),
      text: `Within 24 hours: offered to ${list.map((entry) => entry.patient_name).join(', ')}. The first to accept gets it.`,
    });
    return {
      slot: presentSlot(practiceId, slot),
      message: `Offer sent to ${list.length} patient${list.length === 1 ? '' : 's'}`,
    };
  });
}

export function skipPatient(practiceId: string, slotId: string, patientId: string): Result {
  return withSlot(practiceId, slotId, (_record, slot) => {
    if (slot.status !== 'NEEDS_OFFER') return { error: 'This slot has already been offered or filled.' };
    slot.skipped.push(patientId);
    const name = patientLabel(practiceId, patientId);
    slot.history.push({ at: nowIso(), by: actor(), text: `Skipped ${name}.` });
    return { slot: presentSlot(practiceId, slot), message: `Skipped ${name}` };
  });
}

export function approveDecision(practiceId: string, slotId: string): Result {
  return withSlot(practiceId, slotId, (record, slot) => {
    const decision = slot.pending_decision;
    if (slot.status !== 'AWAITING_APPROVAL' || !decision) return { error: 'There’s nothing to approve for this slot.' };
    slot.history.push({ at: nowIso(), by: actor(), text: 'Approved.' });
    if (decision.type === 'BOOK') {
      bookInto(practiceId, slot, decision.patient_id);
      slot.history.push({ at: nowIso(), by: actor(), text: `Booked for ${decision.patient_name}.` });
      return { slot: presentSlot(practiceId, slot), message: `Approved. Booked for ${decision.patient_name}` };
    }
    sendOffer(practiceId, record, slot, decision.patient_id);
    return { slot: presentSlot(practiceId, slot), message: `Approved. Offer sent to ${decision.patient_name}` };
  });
}

export function rejectDecision(practiceId: string, slotId: string, reason: string): Result {
  return withSlot(practiceId, slotId, (_record, slot) => {
    const decision = slot.pending_decision;
    if (slot.status !== 'AWAITING_APPROVAL' || !decision) return { error: 'There’s nothing to reject for this slot.' };
    slot.skipped.push(decision.patient_id);
    slot.history.push({
      at: nowIso(),
      by: actor(),
      text: `Rejected ${decision.type === 'BOOK' ? 'booking' : 'the offer to'} ${decision.patient_name}: “${reason}”.`,
    });
    slot.pending_decision = null;
    slot.status = 'NEEDS_OFFER';
    return { slot: presentSlot(practiceId, slot), message: 'Rejected. The slot can be offered again' };
  });
}

export function recordReply(
  practiceId: string,
  slotId: string,
  patientId: string,
  reply: 'ACCEPTED' | 'DECLINED',
): Result {
  return withSlot(practiceId, slotId, (record, slot) => {
    const offer = slot.offers.find((item) => item.patient_id === patientId && item.state === 'OPEN');
    if (!offer || !['OFFERED', 'FIRST_TO_ACCEPT'].includes(slot.status)) {
      return { error: 'This offer is no longer open.' };
    }
    if (reply === 'ACCEPTED') {
      offer.state = 'ACCEPTED';
      bookInto(practiceId, slot, patientId);
      slot.history.push({ at: nowIso(), by: actor(), text: `${offer.patient_name} accepted. Appointment booked.` });
      return { slot: presentSlot(practiceId, slot), message: `Booked for ${offer.patient_name}` };
    }
    offer.state = 'DECLINED';
    setWaiting(record, patientId, 'WAITING');
    slot.history.push({ at: nowIso(), by: actor(), text: `${offer.patient_name} declined.` });
    if (!slot.offers.some((item) => item.state === 'OPEN')) slot.status = 'NEEDS_OFFER';
    return {
      slot: presentSlot(practiceId, slot),
      message: `${offer.patient_name} declined. Offer it to the next patient`,
    };
  });
}

export function addToWaitingList(practiceId: string, patientId: string, window: WaitlistWindow, reason: string) {
  const record = waitlistFor(practiceId);
  const entry: WaitlistRecordEntry = {
    id: mockId(`waitlist:${practiceId}`, record.waitlist.length + (Date.now() % 100_000)),
    practice_id: practiceId,
    patient_id: patientId,
    patient_name: patientLabel(practiceId, patientId),
    window,
    reason,
    added_at: nowIso(),
    status: 'WAITING',
  };
  record.waitlist.push(entry);
  saveDb();
  return presentWaitlistEntry(practiceId, entry);
}

export function isWaiting(practiceId: string, patientId: string) {
  return waitlistFor(practiceId).waitlist.some((entry) => entry.patient_id === patientId && entry.status !== 'BOOKED');
}

export function presentCancelRequest(practiceId: string, request: CancelRequestRecord): CancelRequest {
  return { ...request, cancellation_count: cancellationCount(practiceId, request.patient_id) };
}
