import { crmRequest } from './http';
import type {
  HealthEntry,
  HealthEntryKind,
  HomeVisit,
  HomeVisitListParams,
  HomeVisitRequest,
  HomeVisitSummary,
  HomeVisitWindow,
  LetterListParams,
  LetterRequest,
  LetterStatus,
  Paginated,
  PatientHealth,
  TestResult,
  TestResultListParams,
  TestResultOutcome,
} from './types';

// Clinical sprint 16 features (docs/plans/sprint-16-modules.md §1–4, §6). No backend exists yet:
// the paths follow the `public/v1` practice pattern and are inferred.
const base = (subAppId: string, practiceId: string) => `/public/v1/sub-apps/${subAppId}/practices/${practiceId}/`;

export const CLINICAL_TEXT_MAX = 500;

export const clinicalApi = {
  homeVisitRequests: (subAppId: string, practiceId: string, signal?: AbortSignal) =>
    crmRequest<HomeVisitRequest[]>(`${base(subAppId, practiceId)}home-visit-requests/`, { signal }),
  homeVisits: (subAppId: string, practiceId: string, params: HomeVisitListParams, signal?: AbortSignal) =>
    crmRequest<Paginated<HomeVisit>>(`${base(subAppId, practiceId)}home-visits/`, { query: { ...params }, signal }),
  homeVisitSummary: (subAppId: string, practiceId: string, signal?: AbortSignal) =>
    crmRequest<HomeVisitSummary>(`${base(subAppId, practiceId)}home-visits/summary/`, { signal }),
  bookHomeVisit: (
    subAppId: string,
    practiceId: string,
    input: { ticket_id: string; clinician_id: string; date: string; window: HomeVisitWindow; notes: string },
  ) => crmRequest<HomeVisit>(`${base(subAppId, practiceId)}home-visits/`, { method: 'POST', body: input }),
  completeHomeVisit: (subAppId: string, practiceId: string, visitId: string) =>
    crmRequest<HomeVisit>(`${base(subAppId, practiceId)}home-visits/${visitId}/complete/`, { method: 'POST' }),

  testResults: (subAppId: string, practiceId: string, params: TestResultListParams, signal?: AbortSignal) =>
    crmRequest<Paginated<TestResult>>(`${base(subAppId, practiceId)}test-results/`, { query: { ...params }, signal }),
  /** Release a result to the patient. Borderline and abnormal results need a comment and `reviewed`. */
  releaseTestResult: (subAppId: string, practiceId: string, resultId: string, comment: string, reviewed: boolean) =>
    crmRequest<TestResult>(`${base(subAppId, practiceId)}test-results/${resultId}/release/`, {
      method: 'POST',
      body: { comment, reviewed },
    }),
  patientTestResults: (subAppId: string, practiceId: string, patientId: string, signal?: AbortSignal) =>
    crmRequest<TestResult[]>(`${base(subAppId, practiceId)}patients/${patientId}/test-results/`, { signal }),

  patientHealth: (subAppId: string, practiceId: string, patientId: string, signal?: AbortSignal) =>
    crmRequest<PatientHealth>(`${base(subAppId, practiceId)}patients/${patientId}/health/`, { signal }),
  reviewHealthEntry: (
    subAppId: string,
    practiceId: string,
    patientId: string,
    entryId: string,
    decision: 'ADD' | 'DISMISS',
    reason?: string,
  ) =>
    crmRequest<HealthEntry>(`${base(subAppId, practiceId)}patients/${patientId}/health/${entryId}/review/`, {
      method: 'POST',
      body: { decision, reason },
    }),

  letterRequests: (subAppId: string, practiceId: string, params: LetterListParams, signal?: AbortSignal) =>
    crmRequest<Paginated<LetterRequest>>(`${base(subAppId, practiceId)}letter-requests/`, {
      query: { ...params },
      signal,
    }),
  startLetter: (subAppId: string, practiceId: string, letterId: string) =>
    crmRequest<LetterRequest>(`${base(subAppId, practiceId)}letter-requests/${letterId}/start/`, { method: 'POST' }),
  letterFee: (subAppId: string, practiceId: string, letterId: string, fee: string) =>
    crmRequest<LetterRequest>(`${base(subAppId, practiceId)}letter-requests/${letterId}/fee/`, {
      method: 'POST',
      body: { fee },
    }),
  letterReady: (subAppId: string, practiceId: string, letterId: string, fileName: string) =>
    crmRequest<LetterRequest>(`${base(subAppId, practiceId)}letter-requests/${letterId}/ready/`, {
      method: 'POST',
      body: { file_name: fileName },
    }),
  declineLetter: (subAppId: string, practiceId: string, letterId: string, reason: string) =>
    crmRequest<LetterRequest>(`${base(subAppId, practiceId)}letter-requests/${letterId}/decline/`, {
      method: 'POST',
      body: { reason },
    }),
};

export const HOME_VISIT_WINDOW_LABELS: Record<HomeVisitWindow, string> = {
  MORNING: 'Morning (09:00–12:00)',
  AFTERNOON: 'Afternoon (13:00–17:00)',
};

export const TEST_OUTCOME_LABELS: Record<TestResultOutcome, string> = {
  NORMAL: 'Normal',
  BORDERLINE: 'Borderline',
  FOLLOW_UP: 'Needs Follow-up',
};

export const HEALTH_KIND_LABELS: Record<HealthEntryKind, string> = {
  CONDITION: 'Condition',
  ALLERGY: 'Allergy',
  REACTION: 'Adverse Reaction',
  VACCINATION: 'Vaccination',
};

export const LETTER_STATUS_LABELS: Record<LetterStatus, string> = {
  SENT: 'Sent',
  IN_PROGRESS: 'In Progress',
  FEE_TO_CONFIRM: 'Fee to Confirm',
  READY: 'Ready',
  DECLINED: 'Declined',
};

export const LETTER_TYPES = ['Fit to travel / fly', 'School or college absence', 'Proof of registration', 'Other'];
