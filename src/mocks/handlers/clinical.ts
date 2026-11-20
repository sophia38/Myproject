import dayjs from 'dayjs';
import { http } from 'msw/http';
import { CLINICAL_TEXT_MAX } from '@/lib/api/clinical';
import { CRM_API } from '@/lib/api/config';
import type { HomeVisitWindow, TestResult } from '@/lib/api/types';
import { assignableStaff } from '../fixtures/tickets';
import {
  bookHomeVisit,
  clinicalFor,
  presentHealthEntry,
  presentRequest,
  releasedBy,
  reviewEnabled,
} from '../clinicalState';
import { getDb, saveDb, visiblePractices } from '../store';
import { fail, forbidden, ok, paginate, unauthorized } from '../respond';

// Clinical sprint 16 mocks (home visits, test results, patient health, letter requests). Inferred paths.

const practicePath = (path: string) => `*${CRM_API}/public/v1/sub-apps/:subAppId/practices/:practiceId/${path}`;

function guard(practiceId: string) {
  if (!getDb().session.signedIn) return unauthorized();
  if (!visiblePractices().some((practice) => practice.id === practiceId)) return forbidden();
  return null;
}

const matches = (search: string | null | undefined, ...values: string[]) =>
  !search || values.some((value) => value.toLowerCase().includes(search.trim().toLowerCase()));

const presentResult = (result: TestResult) => result;

export const clinicalHandlers = [
  // ---------- Home visits ----------
  http.get(practicePath('home-visit-requests/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const record = clinicalFor(practiceId);
    return ok(record.requests.map((request) => presentRequest(record, request)));
  }),

  http.get(practicePath('home-visits/summary/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const record = clinicalFor(practiceId);
    return ok({
      requests_to_book: record.requests.filter((request) => !request.visit_id).length,
      booked: record.visits.filter((visit) => visit.status === 'BOOKED').length,
      completed: record.visits.filter((visit) => visit.status === 'COMPLETED').length,
    });
  }),

  http.get(practicePath('home-visits/'), ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const status = query.get('status');
    const staffId = query.get('staff_id');
    const rows = clinicalFor(practiceId)
      .visits.filter((visit) => !status || visit.status === status)
      .filter((visit) => !staffId || visit.clinician.id === staffId)
      .filter((visit) => matches(query.get('search'), visit.patient_name, visit.address))
      // Booked first, by date; completed after, newest first.
      .sort((a, b) =>
        a.status !== b.status
          ? a.status === 'BOOKED'
            ? -1
            : 1
          : a.status === 'BOOKED'
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date),
      );
    return ok(paginate(request, rows));
  }),

  http.post(practicePath('home-visits/'), async ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const body = (await request.json()) as {
      ticket_id?: string;
      clinician_id?: string;
      date?: string;
      window?: HomeVisitWindow;
      notes?: string;
    };
    const db = getDb();
    const clinician = assignableStaff(db.staff, db.roles, practiceId).find((item) => item.id === body.clinician_id);
    const errors = [
      ...(!clinician ? [{ field: 'clinician_id', message: 'Clinician is required' }] : []),
      ...(!body.date ? [{ field: 'date', message: 'Date is required' }] : []),
      ...(body.date && dayjs(body.date).isBefore(dayjs(), 'day')
        ? [{ field: 'date', message: 'Date can’t be in the past' }]
        : []),
      ...(!body.window ? [{ field: 'window', message: 'Time window is required' }] : []),
      ...(String(body.notes ?? '').length > CLINICAL_TEXT_MAX
        ? [{ field: 'notes', message: `Notes must be ${CLINICAL_TEXT_MAX} characters or fewer` }]
        : []),
    ];
    if (errors.length || !clinician) return fail(400, errors[0].message, errors);
    const result = bookHomeVisit(practiceId, {
      ticket_id: String(body.ticket_id ?? ''),
      clinician,
      date: String(body.date),
      window: body.window as HomeVisitWindow,
      notes: String(body.notes ?? '').trim(),
    });
    return 'error' in result ? fail(400, result.error ?? 'Failed') : ok(result.visit, 'Home visit booked');
  }),

  http.post(practicePath('home-visits/:visitId/complete/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const visit = clinicalFor(practiceId).visits.find((item) => item.id === params.visitId);
    if (!visit) return fail(404, 'Home visit not found');
    if (visit.status === 'COMPLETED') return fail(400, 'This home visit is already completed.');
    visit.status = 'COMPLETED';
    saveDb();
    return ok(visit, 'Home visit marked as completed');
  }),

  // ---------- Test results ----------
  http.get(practicePath('test-results/'), ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const status = query.get('status');
    const outcome = query.get('outcome');
    const rows = clinicalFor(practiceId)
      .results.filter((result) => !status || result.status === status)
      .filter((result) => !outcome || result.outcome === outcome)
      .filter((result) => matches(query.get('search'), result.patient_name, result.name))
      .sort((a, b) =>
        status === 'RELEASED'
          ? String(b.released_at).localeCompare(String(a.released_at))
          : a.taken_at.localeCompare(b.taken_at),
      )
      .map(presentResult);
    return ok(paginate(request, rows));
  }),

  http.post(practicePath('test-results/:resultId/release/'), async ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const result = clinicalFor(practiceId).results.find((item) => item.id === params.resultId);
    if (!result) return fail(404, 'Result not found');
    if (result.status !== 'AWAITING_RELEASE') return fail(400, 'This result can’t be released.');
    const body = (await request.json()) as { comment?: string; reviewed?: boolean };
    const comment = String(body.comment ?? '').trim();
    // Abnormal results are never released without a clinician's comment and confirmation.
    if (result.outcome !== 'NORMAL' && (!comment || !body.reviewed)) {
      return fail(400, 'Comment is required', [{ field: 'comment', message: 'Comment is required' }]);
    }
    if (comment.length > CLINICAL_TEXT_MAX) {
      return fail(400, `Comment must be ${CLINICAL_TEXT_MAX} characters or fewer`);
    }
    Object.assign(result, {
      status: 'RELEASED',
      comment: comment || null,
      released_at: dayjs().toISOString(),
      released_by: releasedBy(),
    });
    saveDb();
    return ok(result, 'Released to the patient');
  }),

  http.get(practicePath('patients/:patientId/test-results/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    return ok(
      clinicalFor(practiceId)
        .results.filter((result) => result.patient_id === params.patientId)
        .sort((a, b) => b.taken_at.localeCompare(a.taken_at)),
    );
  }),

  // ---------- Patient health ----------
  http.get(practicePath('patients/:patientId/health/'), ({ params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    return ok({
      review_enabled: reviewEnabled(practiceId),
      entries: clinicalFor(practiceId)
        .health.filter((entry) => entry.patient_id === params.patientId)
        .map((entry) => presentHealthEntry(practiceId, entry)),
    });
  }),

  http.post(practicePath('patients/:patientId/health/:entryId/review/'), async ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    if (!reviewEnabled(practiceId)) return fail(400, 'Clinician review is turned off for this practice.');
    const entry = clinicalFor(practiceId).health.find(
      (item) => item.id === params.entryId && item.patient_id === params.patientId,
    );
    if (!entry || entry.source !== 'PATIENT') return fail(404, 'Entry not found');
    const body = (await request.json()) as { decision?: 'ADD' | 'DISMISS'; reason?: string };
    const reason = String(body.reason ?? '').trim();
    if (body.decision === 'DISMISS' && !reason) {
      return fail(400, 'Reason is required', [{ field: 'reason', message: 'Reason is required' }]);
    }
    entry.review = body.decision === 'ADD' ? 'ADDED' : 'DISMISSED';
    entry.review_reason = body.decision === 'DISMISS' ? reason : null;
    saveDb();
    return ok(
      presentHealthEntry(practiceId, entry),
      body.decision === 'ADD' ? 'Added to the GP record' : 'Entry dismissed',
    );
  }),

  // ---------- Letter requests ----------
  http.get(practicePath('letter-requests/'), ({ request, params }) => {
    const practiceId = String(params.practiceId);
    const denied = guard(practiceId);
    if (denied) return denied;
    const query = new URL(request.url).searchParams;
    const status = query.get('status');
    const rows = clinicalFor(practiceId)
      .letters.filter((letter) => !status || letter.status === status)
      .filter((letter) => matches(query.get('search'), letter.patient_name, letter.type))
      .sort((a, b) => b.received_at.localeCompare(a.received_at));
    return ok(paginate(request, rows));
  }),

  ...(['start', 'fee', 'ready', 'decline'] as const).map((action) =>
    http.post(practicePath(`letter-requests/:letterId/${action}/`), async ({ request, params }) => {
      const practiceId = String(params.practiceId);
      const denied = guard(practiceId);
      if (denied) return denied;
      const letter = clinicalFor(practiceId).letters.find((item) => item.id === params.letterId);
      if (!letter) return fail(404, 'Letter request not found');
      if (letter.status === 'READY' || letter.status === 'DECLINED') {
        return fail(400, 'This request is already finished.');
      }
      const body = action === 'start' ? {} : ((await request.json()) as Record<string, string | undefined>);
      if (action === 'start') {
        letter.status = 'IN_PROGRESS';
      } else if (action === 'fee') {
        const fee = String(body.fee ?? '').trim();
        if (!fee) return fail(400, 'Fee is required', [{ field: 'fee', message: 'Fee is required' }]);
        letter.fee = fee;
        letter.status = 'FEE_TO_CONFIRM';
      } else if (action === 'ready') {
        letter.file_name = String(body.file_name || `${letter.type.replace(/\W+/g, '_')}.pdf`);
        letter.status = 'READY';
      } else {
        const reason = String(body.reason ?? '').trim();
        if (!reason) return fail(400, 'Reason is required', [{ field: 'reason', message: 'Reason is required' }]);
        letter.decline_reason = reason;
        letter.status = 'DECLINED';
      }
      saveDb();
      const messages = {
        start: 'Letter request started',
        fee: 'Fee sent to the patient',
        ready: 'Letter marked as ready',
        decline: 'Letter request declined',
      };
      return ok(letter, messages[action]);
    }),
  ),
];
