import { crmRequest } from './http';
import type {
  CancelRequest,
  CancelRequestListParams,
  GlobalAppointmentConfiguration,
  Paginated,
  ReleasedSlot,
  ReleasedSlotListParams,
  ReleasedSlotStatus,
  ReleasedSlotSummary,
  SlotSuggestion,
  WaitlistEntry,
  WaitlistListParams,
  WaitlistStatus,
  WaitlistWindow,
} from './types';

// Cancellations and automatic waitlist filling (sprint 16, docs/plans/sprint-16-modules.md §5).
// No backend exists yet: the paths follow the `public/v1` practice pattern and are inferred.
const practiceBase = (subAppId: string, practiceId: string) =>
  `/public/v1/sub-apps/${subAppId}/practices/${practiceId}/`;
const slots = (subAppId: string, practiceId: string) => `${practiceBase(subAppId, practiceId)}released-slots/`;
const waiting = (subAppId: string, practiceId: string) => `${practiceBase(subAppId, practiceId)}waiting-list/`;
const requests = (subAppId: string, practiceId: string) => `${practiceBase(subAppId, practiceId)}cancel-requests/`;

export const WAITLIST_REASON_MAX = 250;

export type WaitlistSettings = Pick<
  GlobalAppointmentConfiguration,
  | 'frequent_canceller_warning'
  | 'frequent_canceller_threshold'
  | 'frequent_canceller_months'
  | 'waitlist_hold_hours'
  | 'waitlist_first_to_accept_count'
  | 'waitlist_two_week_fallback'
  | 'waitlist_manager_approval'
  | 'patient_entries_need_review'
>;

/** Defaults agreed on 15/11/2026: amber at 3 and red at 6 in 6 months; offers held 2 hours. */
export const WAITLIST_SETTINGS_DEFAULTS: WaitlistSettings = {
  frequent_canceller_warning: 3,
  frequent_canceller_threshold: 6,
  frequent_canceller_months: 6,
  waitlist_hold_hours: 2,
  waitlist_first_to_accept_count: 3,
  waitlist_two_week_fallback: true,
  waitlist_manager_approval: true,
  // 15/11/2026: patient-added entries are self-reported; review stays off unless the practice turns it on.
  patient_entries_need_review: false,
};

export const waitlistApi = {
  slots: (subAppId: string, practiceId: string, params: ReleasedSlotListParams, signal?: AbortSignal) =>
    crmRequest<Paginated<ReleasedSlot>>(slots(subAppId, practiceId), { query: { ...params }, signal }),
  slotSummary: (subAppId: string, practiceId: string, signal?: AbortSignal) =>
    crmRequest<ReleasedSlotSummary>(`${slots(subAppId, practiceId)}summary/`, { signal }),
  slot: (subAppId: string, practiceId: string, slotId: string, signal?: AbortSignal) =>
    crmRequest<ReleasedSlot>(`${slots(subAppId, practiceId)}${slotId}/`, { signal }),
  /** Waiting patients for a slot: the 1-week list first, then the 2-week list when fallback is on. */
  suggestions: (subAppId: string, practiceId: string, slotId: string, signal?: AbortSignal) =>
    crmRequest<SlotSuggestion[]>(`${slots(subAppId, practiceId)}${slotId}/suggestions/`, { signal }),
  /** Offer the slot to a patient, or book them directly when they've agreed by phone. */
  offer: (subAppId: string, practiceId: string, slotId: string, patientId: string, bookDirectly = false) =>
    crmRequest<ReleasedSlot>(`${slots(subAppId, practiceId)}${slotId}/offer/`, {
      method: 'POST',
      body: { patient_id: patientId, book_directly: bookDirectly },
    }),
  /** Within 24 hours: offer to the first patients in line; the first to accept gets it. */
  offerFirstInLine: (subAppId: string, practiceId: string, slotId: string) =>
    crmRequest<ReleasedSlot>(`${slots(subAppId, practiceId)}${slotId}/offer-first-in-line/`, { method: 'POST' }),
  skip: (subAppId: string, practiceId: string, slotId: string, patientId: string) =>
    crmRequest<ReleasedSlot>(`${slots(subAppId, practiceId)}${slotId}/skip/`, {
      method: 'POST',
      body: { patient_id: patientId },
    }),
  approve: (subAppId: string, practiceId: string, slotId: string) =>
    crmRequest<ReleasedSlot>(`${slots(subAppId, practiceId)}${slotId}/approve/`, { method: 'POST' }),
  reject: (subAppId: string, practiceId: string, slotId: string, reason: string) =>
    crmRequest<ReleasedSlot>(`${slots(subAppId, practiceId)}${slotId}/reject/`, {
      method: 'POST',
      body: { reason },
    }),
  /** Staff record the patient's reply (until replies come from the patient app). */
  recordReply: (
    subAppId: string,
    practiceId: string,
    slotId: string,
    patientId: string,
    reply: 'ACCEPTED' | 'DECLINED',
  ) =>
    crmRequest<ReleasedSlot>(`${slots(subAppId, practiceId)}${slotId}/reply/`, {
      method: 'POST',
      body: { patient_id: patientId, reply },
    }),

  waitingList: (subAppId: string, practiceId: string, params: WaitlistListParams, signal?: AbortSignal) =>
    crmRequest<Paginated<WaitlistEntry>>(waiting(subAppId, practiceId), { query: { ...params }, signal }),
  addToWaitingList: (
    subAppId: string,
    practiceId: string,
    input: { patient_id: string; window: WaitlistWindow; reason: string },
  ) => crmRequest<WaitlistEntry>(waiting(subAppId, practiceId), { method: 'POST', body: input }),

  cancelRequests: (subAppId: string, practiceId: string, params: CancelRequestListParams, signal?: AbortSignal) =>
    crmRequest<Paginated<CancelRequest>>(requests(subAppId, practiceId), { query: { ...params }, signal }),
  cancelFromRequest: (subAppId: string, practiceId: string, requestId: string) =>
    crmRequest<CancelRequest>(`${requests(subAppId, practiceId)}${requestId}/cancel/`, { method: 'POST' }),
  keepFromRequest: (subAppId: string, practiceId: string, requestId: string) =>
    crmRequest<CancelRequest>(`${requests(subAppId, practiceId)}${requestId}/keep/`, { method: 'POST' }),

  /** Patient id → patient cancellations in the frequent-canceller period (staff only). */
  cancellationCounts: (subAppId: string, practiceId: string, signal?: AbortSignal) =>
    crmRequest<{ counts: Record<string, number>; warning: number; threshold: number; months: number }>(
      `${practiceBase(subAppId, practiceId)}cancellation-counts/`,
      { signal },
    ),
};

export const SLOT_STATUS_LABELS: Record<ReleasedSlotStatus, string> = {
  NEEDS_OFFER: 'Needs Offering',
  AWAITING_APPROVAL: 'Awaiting Approval',
  OFFERED: 'Offered',
  FIRST_TO_ACCEPT: 'First to Accept',
  BOOKED: 'Booked',
  NOT_FILLED: 'Not Filled',
};

export const WAITLIST_WINDOW_LABELS: Record<WaitlistWindow, string> = {
  ONE_WEEK: 'Within 1 week',
  TWO_WEEKS: 'Within 2 weeks',
};

export const WAITLIST_STATUS_LABELS: Record<WaitlistStatus, string> = {
  WAITING: 'Waiting',
  OFFERED: 'Offer Open',
  BOOKED: 'Booked',
};

export const CANCEL_REQUEST_STATUS_LABELS: Record<CancelRequest['status'], string> = {
  NEW: 'New',
  CANCELLED: 'Cancelled',
  KEPT: 'Kept',
};
