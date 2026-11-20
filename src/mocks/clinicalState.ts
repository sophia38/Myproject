import dayjs from 'dayjs';
import { patientName } from '@/lib/api/patients';
import type {
  HealthEntry,
  HomeVisit,
  HomeVisitRequest,
  HomeVisitWindow,
  LetterRequest,
  Patient,
  TestResult,
  TicketStaff,
} from '@/lib/api/types';
import { TICKET_OPEN_STATUSES } from '@/lib/api/types';
import { WAITLIST_SETTINGS_DEFAULTS } from '@/lib/api/waitlist';
import { mockId } from './fixtures/random';
import { assignableStaff } from './fixtures/tickets';
import { practiceSettingsFor } from './practiceSettingsState';
import { currentPersona, getDb, saveDb } from './store';

// Clinical sprint 16 mocks: home visits, test results, patient health entries and letter requests.
// Seeded per practice the first time they're read. All people and values are fictional. The patient
// app (where patients ask for visits, add entries and request letters) isn't in this repo, so its
// side is seeded.

type RequestRecord = Omit<HomeVisitRequest, 'visit'> & { visit_id: string | null };

export interface ClinicalRecord {
  requests: RequestRecord[];
  visits: HomeVisit[];
  results: TestResult[];
  health: HealthEntry[];
  letters: LetterRequest[];
}

const actor = () => {
  const persona = currentPersona();
  return `${persona.firstName} ${persona.lastName}`;
};
const iso = (days: number, time = '09:00') => {
  const [hour, minute] = time.split(':').map(Number);
  return dayjs().add(days, 'day').hour(hour).minute(minute).second(0).millisecond(0).toISOString();
};
const dateOnly = (days: number) => dayjs().add(days, 'day').format('YYYY-MM-DD');
export const addressOf = (patient: Patient | undefined) =>
  patient
    ? [patient.address.street_address, patient.address.address_line_2, patient.address.city, patient.address.post_code]
        .filter(Boolean)
        .join(', ')
    : '';

export function reviewEnabled(practiceId: string) {
  return { ...WAITLIST_SETTINGS_DEFAULTS, ...practiceSettingsFor(practiceId).appointment }.patient_entries_need_review;
}

function seedPractice(practiceId: string): ClinicalRecord {
  const db = getDb();
  const patients = db.patients.filter((item) => item.practice_id === practiceId && !item.archived);
  const byId = new Map(patients.map((item) => [item.id, item]));
  const staff: TicketStaff[] = assignableStaff(db.staff, db.roles, practiceId);
  const clinician = staff[0] ?? { id: 'staff', name: 'Duty GP', role: 'GP' };
  const openTickets = db.tickets
    .filter(
      (ticket) =>
        ticket.practice_id === practiceId && (TICKET_OPEN_STATUSES as readonly string[]).includes(ticket.status),
    )
    // Newest first, so the requests show on the first page of Tickets.
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const record: ClinicalRecord = { requests: [], visits: [], results: [], health: [], letters: [] };

  // Home visits: two requests to book, one booked, one completed earlier.
  const reasons = ['Can’t leave home (housebound)', 'Too ill to travel', 'Can’t leave home (housebound)'];
  openTickets.slice(0, 3).forEach((ticket, index) => {
    record.requests.push({
      ticket_id: ticket.id,
      patient_id: ticket.patient_id,
      patient_name: ticket.patient_name,
      reason: reasons[index],
      requested_at: iso(-1 - index, '16:20'),
      visit_id: null,
    });
  });
  const visit = (
    index: number,
    patient: { id: string; name: string },
    ticketId: string | null,
    days: number,
    window: HomeVisitWindow,
    reason: string,
    status: HomeVisit['status'],
  ): HomeVisit => ({
    id: mockId(`home-visit:${practiceId}`, index),
    practice_id: practiceId,
    ticket_id: ticketId,
    patient_id: patient.id,
    patient_name: patient.name,
    address: addressOf(byId.get(patient.id)),
    clinician,
    date: dateOnly(days),
    window,
    reason,
    notes: index === 0 ? 'Key safe by the back door; code given by phone.' : '',
    status,
    booked_at: iso(days - 2, '11:00'),
    booked_by: 'Jo Bennett',
  });
  const third = record.requests[2];
  if (third) {
    const booked = visit(
      0,
      { id: third.patient_id, name: third.patient_name },
      third.ticket_id,
      2,
      'AFTERNOON',
      third.reason,
      'BOOKED',
    );
    record.visits.push(booked);
    third.visit_id = booked.id;
  }
  const past = patients[5];
  if (past) {
    record.visits.push(
      visit(
        1,
        { id: past.id, name: patientName(past) },
        null,
        -12,
        'MORNING',
        'Medication review at home',
        'COMPLETED',
      ),
    );
  }

  // Test results: waiting for release (normal, borderline, needs follow-up), one pending, one released.
  const result = (
    index: number,
    patient: Patient,
    name: string,
    days: number,
    outcome: TestResult['outcome'],
    status: TestResult['status'],
    values: TestResult['values'],
    source = 'GP-ordered',
  ): TestResult => ({
    id: mockId(`test-result:${practiceId}`, index),
    practice_id: practiceId,
    patient_id: patient.id,
    patient_name: patientName(patient),
    name,
    source,
    taken_at: iso(days, '09:10'),
    status,
    outcome,
    values,
    comment: status === 'RELEASED' ? 'Normal, no action needed.' : null,
    released_at: status === 'RELEASED' ? iso(days + 2, '12:00') : null,
    released_by: status === 'RELEASED' ? 'Dr Hannah Whitcombe' : null,
  });
  const [first, second, third2] = patients;
  if (first) {
    record.results.push(
      result(0, first, 'Full blood count (FBC)', -6, 'NORMAL', 'AWAITING_RELEASE', [
        { name: 'Haemoglobin', value: '138 g/L', range: '130–180' },
        { name: 'White cells', value: '6.2 ×10⁹/L', range: '4.0–11.0' },
        { name: 'Platelets', value: '245 ×10⁹/L', range: '150–400' },
      ]),
      result(1, first, 'HbA1c (blood sugar)', -6, 'BORDERLINE', 'AWAITING_RELEASE', [
        { name: 'HbA1c', value: '44 mmol/mol', range: '20–41' },
      ]),
      result(2, first, 'Vitamin D', -1, null, 'PENDING', []),
      result(
        3,
        first,
        'Cholesterol (lipid profile)',
        -88,
        'NORMAL',
        'RELEASED',
        [{ name: 'Total cholesterol', value: '4.6 mmol/L', range: 'under 5.0' }],
        'Health check',
      ),
    );
  }
  if (second) {
    record.results.push(
      result(4, second, 'Kidney function (U&E)', -3, 'FOLLOW_UP', 'AWAITING_RELEASE', [
        { name: 'eGFR', value: '52 mL/min', range: 'over 60' },
        { name: 'Creatinine', value: '128 µmol/L', range: '60–110' },
      ]),
    );
  }

  // Health entries: GP-record entries and ones the patient added in the app.
  const entry = (
    index: number,
    patient: Patient,
    kind: HealthEntry['kind'],
    name: string,
    detail: string,
    source: HealthEntry['source'],
    extra: Partial<HealthEntry> = {},
  ): HealthEntry => ({
    id: mockId(`health:${practiceId}`, index),
    patient_id: patient.id,
    kind,
    name,
    detail,
    severity: null,
    date: null,
    source,
    added_at: source === 'PATIENT' ? iso(-3 - index, '20:10') : iso(-400, '10:00'),
    review: null,
    review_reason: null,
    ...extra,
  });
  if (first) {
    record.health.push(
      entry(0, first, 'CONDITION', 'Asthma', 'Since 2012', 'GP_RECORD'),
      entry(1, first, 'ALLERGY', 'Penicillin', 'Rash and swelling', 'GP_RECORD', { severity: 'Severe' }),
      entry(2, first, 'CONDITION', 'Hay fever', 'Seasonal, spring and summer', 'PATIENT'),
      entry(3, first, 'REACTION', 'Ibuprofen', 'Stomach pain after a few days', 'PATIENT'),
      entry(4, first, 'VACCINATION', 'Flu (seasonal)', 'Ashford Medical Centre', 'GP_RECORD', { date: dateOnly(-35) }),
      entry(5, first, 'VACCINATION', 'COVID-19 booster', 'Local pharmacy', 'GP_RECORD', { date: dateOnly(-230) }),
      entry(6, first, 'VACCINATION', 'Hepatitis A (travel)', 'Travel clinic', 'PATIENT', { date: dateOnly(-560) }),
    );
  }
  if (third2) {
    record.health.push(
      entry(7, third2, 'CONDITION', 'Type 2 diabetes', 'Since 2019', 'GP_RECORD'),
      entry(8, third2, 'ALLERGY', 'Peanuts', 'Swollen lips', 'PATIENT', { severity: 'Moderate' }),
    );
  }

  // Letter requests from the patient app.
  const letter = (
    index: number,
    patient: Patient | undefined,
    type: string,
    purpose: string,
    status: LetterRequest['status'],
    days: number,
    neededIn: number | null,
  ) => {
    if (!patient) return;
    record.letters.push({
      id: mockId(`letter:${practiceId}`, index),
      practice_id: practiceId,
      patient_id: patient.id,
      patient_name: patientName(patient),
      type,
      purpose,
      needed_by: neededIn === null ? null : dateOnly(neededIn),
      delivery: index === 1 ? 'COLLECT' : 'IN_APP',
      status,
      received_at: iso(days, '14:00'),
      fee: null,
      file_name: status === 'READY' ? 'Proof_of_registration.pdf' : null,
      decline_reason: null,
    });
  };
  letter(
    0,
    patients[2],
    'Fit to travel / fly',
    'The airline needs confirmation I’m fit to fly on 12/12/2026.',
    'SENT',
    -1,
    18,
  );
  letter(
    1,
    patients[3],
    'School or college absence',
    'Letter for my son’s school about his hospital visit.',
    'IN_PROGRESS',
    -2,
    6,
  );
  letter(2, patients[4], 'Proof of registration', 'Needed for a housing application.', 'READY', -6, null);

  return record;
}

export function clinicalFor(practiceId: string): ClinicalRecord {
  const db = getDb();
  if (!db.clinical[practiceId]) {
    db.clinical[practiceId] = seedPractice(practiceId);
    saveDb();
  }
  return db.clinical[practiceId];
}

export function presentRequest(record: ClinicalRecord, request: RequestRecord): HomeVisitRequest {
  const { visit_id: visitId, ...rest } = request;
  return { ...rest, visit: record.visits.find((item) => item.id === visitId) ?? null };
}

/** With clinician review on, a patient's own entry is awaiting review until it's added or dismissed. */
export function presentHealthEntry(practiceId: string, entry: HealthEntry): HealthEntry {
  if (entry.source !== 'PATIENT') return entry;
  if (!reviewEnabled(practiceId)) return { ...entry, review: entry.review === 'DISMISSED' ? 'DISMISSED' : null };
  return { ...entry, review: entry.review ?? 'AWAITING' };
}

export function bookHomeVisit(
  practiceId: string,
  input: { ticket_id: string; clinician: TicketStaff; date: string; window: HomeVisitWindow; notes: string },
) {
  const db = getDb();
  const record = clinicalFor(practiceId);
  const request = record.requests.find((item) => item.ticket_id === input.ticket_id);
  if (!request) return { error: 'This consultation didn’t ask for a home visit.' };
  if (request.visit_id) return { error: 'A home visit is already booked for this consultation.' };
  const patient = db.patients.find((item) => item.id === request.patient_id);
  const created: HomeVisit = {
    id: mockId(`home-visit:${practiceId}`, record.visits.length + (Date.now() % 100_000)),
    practice_id: practiceId,
    ticket_id: input.ticket_id,
    patient_id: request.patient_id,
    patient_name: request.patient_name,
    address: addressOf(patient),
    clinician: input.clinician,
    date: input.date,
    window: input.window,
    reason: request.reason,
    notes: input.notes,
    status: 'BOOKED',
    booked_at: dayjs().toISOString(),
    booked_by: actor(),
  };
  record.visits.push(created);
  request.visit_id = created.id;
  saveDb();
  return { visit: created };
}

export const releasedBy = actor;
