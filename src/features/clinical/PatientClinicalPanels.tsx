'use client';

import { useCallback, useEffect, useState } from 'react';
import dayjs from 'dayjs';
import Link from 'next/link';
import { useSnackbar } from 'notistack';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { StatusChip } from '@/components/data/StatusChip';
import { LoadingSpinner } from '@/components/feedback/LoadingSpinner';
import { FormSectionCard } from '@/components/forms/FormSectionCard';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { usePracticeHref } from '@/features/practice/PracticeContext';
import { CLINICAL_TEXT_MAX, clinicalApi, HEALTH_KIND_LABELS, TEST_OUTCOME_LABELS } from '@/lib/api/clinical';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import type { HealthEntry, PatientHealth, TestResult } from '@/lib/api/types';
import { outcomeTone, ResultValues } from './TestResultsPage';

function sourceChip(entry: HealthEntry, reviewOn: boolean) {
  if (entry.source === 'GP_RECORD' || entry.review === 'ADDED') return <StatusChip status="GP record" tone="neutral" />;
  if (entry.review === 'DISMISSED') return <StatusChip status="Dismissed" tone="neutral" variant="outlined" />;
  if (reviewOn) return <StatusChip status="Awaiting review" tone="warning" />;
  return <StatusChip status="Self-reported by patient" tone="secondary" />;
}

function EntryRow({ entry, children }: { entry: HealthEntry; children?: React.ReactNode }) {
  const when =
    entry.kind === 'VACCINATION' && entry.date
      ? `Given ${dayjs(entry.date).format('DD/MM/YYYY')}`
      : entry.source === 'PATIENT'
        ? `Added by the patient ${dayjs(entry.added_at).format('DD/MM/YYYY')}`
        : '';
  return (
    <Box
      component="li"
      sx={(theme) => ({
        display: 'flex',
        gap: 1.5,
        alignItems: 'center',
        flexWrap: 'wrap',
        py: 1.25,
        borderBottom: `1px solid ${theme.tokens.border.medium}`,
        '&:last-of-type': { borderBottom: 0 },
      })}
    >
      <Box sx={{ flex: 1, minWidth: 200 }}>
        <Typography sx={{ fontWeight: 500 }}>
          {entry.name}{' '}
          <Typography component="span" variant="caption">
            · {HEALTH_KIND_LABELS[entry.kind]}
          </Typography>
        </Typography>
        <Typography variant="caption" sx={{ display: 'block' }}>
          {[entry.detail, entry.severity, when].filter(Boolean).join(' · ')}
          {entry.review_reason ? ` · Dismissed: “${entry.review_reason}”` : ''}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

/**
 * Patient profile → Health (sprint 16, docs/plans/sprint-16-modules.md §2–3): conditions, allergies
 * and reactions, and vaccinations, from the GP record and added by the patient in the app. Patient
 * entries are self-reported and view only, unless the practice turns on clinician review (Practice
 * Settings → Appointment Configuration), when clinicians can add them to the record or dismiss them.
 */
export function PatientHealthPanel({ practiceId, patientId }: { practiceId: string; patientId: string }) {
  const { enqueueSnackbar } = useSnackbar();
  const [health, setHealth] = useState<PatientHealth | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [dismissing, setDismissing] = useState<HealthEntry | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    clinicalApi
      .patientHealth(PUBLIC_SUB_APP_ID, practiceId, patientId, controller.signal)
      .then((result) => {
        setHealth(result);
        setFailed(false);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setFailed(true);
        enqueueSnackbar('Failed to load health entries', { variant: 'error' });
      });
    return () => controller.abort();
  }, [practiceId, patientId, attempt, enqueueSnackbar]);

  const review = useCallback(
    async (entry: HealthEntry, decision: 'ADD' | 'DISMISS', reason?: string) => {
      setBusy(true);
      try {
        const saved = await clinicalApi.reviewHealthEntry(
          PUBLIC_SUB_APP_ID,
          practiceId,
          patientId,
          entry.id,
          decision,
          reason,
        );
        setHealth((current) =>
          current
            ? { ...current, entries: current.entries.map((item) => (item.id === saved.id ? saved : item)) }
            : current,
        );
        enqueueSnackbar(decision === 'ADD' ? 'Added to the GP record' : 'Entry dismissed', { variant: 'success' });
        setDismissing(null);
      } catch {
        enqueueSnackbar('Failed to review the entry', { variant: 'error' });
      } finally {
        setBusy(false);
      }
    },
    [practiceId, patientId, enqueueSnackbar],
  );

  if (failed) {
    return (
      <Stack spacing={1.5} sx={{ alignItems: 'center', py: 4 }}>
        <Typography variant="body2" sx={{ color: 'error.main' }}>
          Could not load health entries.
        </Typography>
        <Button variant="outlined" onClick={() => setAttempt((value) => value + 1)}>
          Try Again
        </Button>
      </Stack>
    );
  }
  if (!health) return <LoadingSpinner message="Loading health entries..." />;

  const reviewOn = health.review_enabled;
  const awaiting = health.entries.filter((entry) => entry.review === 'AWAITING');
  const section = (title: string, entries: HealthEntry[], empty: string) => (
    <FormSectionCard title={`${title} (${entries.length})`} collapsible={false}>
      {entries.length === 0 ? (
        <Typography variant="body2">{empty}</Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry}>
              {sourceChip(entry, reviewOn)}
            </EntryRow>
          ))}
        </Box>
      )}
    </FormSectionCard>
  );

  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {reviewOn
          ? 'Entries the patient adds in the app wait for a clinician to add them to the GP record or dismiss them.'
          : 'Entries the patient adds in the app are self-reported. Staff can view them; they aren’t checked by a clinician.'}
      </Alert>
      {reviewOn && (
        <FormSectionCard title={`Awaiting Review (${awaiting.length})`} collapsible={false}>
          {awaiting.length === 0 ? (
            <Typography variant="body2">Nothing to review.</Typography>
          ) : (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {awaiting.map((entry) => (
                <EntryRow key={entry.id} entry={entry}>
                  <Stack direction="row" spacing={1}>
                    <Button size="small" variant="contained" disabled={busy} onClick={() => review(entry, 'ADD')}>
                      Add to Record
                    </Button>
                    <Button size="small" variant="outlined" disabled={busy} onClick={() => setDismissing(entry)}>
                      Dismiss
                    </Button>
                  </Stack>
                </EntryRow>
              ))}
            </Box>
          )}
        </FormSectionCard>
      )}
      {section(
        'Health Conditions',
        health.entries.filter((entry) => entry.kind === 'CONDITION'),
        'No conditions recorded.',
      )}
      {section(
        'Allergies and Adverse Reactions',
        health.entries.filter((entry) => entry.kind === 'ALLERGY' || entry.kind === 'REACTION'),
        'No allergies or reactions recorded.',
      )}
      {section(
        'Vaccinations',
        health.entries.filter((entry) => entry.kind === 'VACCINATION'),
        'No vaccinations recorded.',
      )}
      {dismissing && (
        <ConfirmDialog
          open
          title="Dismiss Entry"
          message={`Dismiss “${dismissing.name}”? It won’t be added to the GP record, and the patient sees your reason.`}
          confirmButtonText="Dismiss"
          confirmButtonVariant="error"
          requireReason={{
            label: 'Reason',
            maxLength: CLINICAL_TEXT_MAX,
            required: true,
            placeholder: 'e.g. Not confirmed by tests',
          }}
          confirmButtonLoading={busy}
          onClose={() => setDismissing(null)}
          onConfirm={(reason) => review(dismissing, 'DISMISS', reason)}
        />
      )}
    </Stack>
  );
}

/** Patient profile → Test Results (sprint 16): the patient's results and whether they've been released. */
export function PatientResultsPanel({ practiceId, patientId }: { practiceId: string; patientId: string }) {
  const { enqueueSnackbar } = useSnackbar();
  const practiceHref = usePracticeHref();
  const [results, setResults] = useState<TestResult[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    clinicalApi
      .patientTestResults(PUBLIC_SUB_APP_ID, practiceId, patientId, controller.signal)
      .then(setResults)
      .catch(() => {
        if (controller.signal.aborted) return;
        setResults([]);
        enqueueSnackbar('Failed to load test results', { variant: 'error' });
      });
    return () => controller.abort();
  }, [practiceId, patientId, enqueueSnackbar]);

  if (!results) return <LoadingSpinner message="Loading test results..." />;
  if (results.length === 0) return <Typography variant="body2">No test results for this patient.</Typography>;

  return (
    <Stack spacing={2}>
      {results.map((result) => (
        <FormSectionCard
          key={result.id}
          title={result.name}
          collapsible={false}
          actions={
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {result.outcome && (
                <StatusChip status={TEST_OUTCOME_LABELS[result.outcome]} tone={outcomeTone(result.outcome)} />
              )}
              <StatusChip
                status={
                  result.status === 'RELEASED'
                    ? 'Released'
                    : result.status === 'PENDING'
                      ? 'Pending'
                      : 'Awaiting release'
                }
                tone={result.status === 'RELEASED' ? 'success' : result.status === 'PENDING' ? 'neutral' : 'warning'}
                variant="outlined"
              />
            </Stack>
          }
        >
          <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
            {result.source} · taken {dayjs(result.taken_at).format('DD/MM/YYYY')}
            {result.released_at &&
              ` · released ${dayjs(result.released_at).format('DD/MM/YYYY')} by ${result.released_by}`}
          </Typography>
          {result.status === 'PENDING' ? (
            <Typography variant="body2">Sample taken. No result yet.</Typography>
          ) : (
            <ResultValues result={result} />
          )}
          {result.comment && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Comment for the patient: “{result.comment}”
            </Typography>
          )}
          {result.status === 'AWAITING_RELEASE' && (
            <Button
              component={Link}
              href={practiceHref('/test-results')}
              size="small"
              variant="outlined"
              sx={{ mt: 1.5 }}
            >
              Review in Test Results
            </Button>
          )}
        </FormSectionCard>
      ))}
    </Stack>
  );
}
