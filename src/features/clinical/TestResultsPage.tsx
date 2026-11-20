'use client';

import { useCallback, useState } from 'react';
import dayjs from 'dayjs';
import { Formik } from 'formik';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSnackbar } from 'notistack';
import * as Yup from 'yup';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Inbox from '@mui/icons-material/InboxOutlined';
import Outbox from '@mui/icons-material/OutboxOutlined';
import Send from '@mui/icons-material/SendOutlined';
import { DataTable, type DataTableColumn } from '@/components/data/DataTable';
import { FilterBar } from '@/components/data/FilterBar';
import { StatusChip } from '@/components/data/StatusChip';
import { ModulePageHeader } from '@/components/layout/ModulePageHeader';
import { FormModal } from '@/components/modals/FormModal';
import { SegmentedTabs } from '@/components/navigation/SegmentedTabs';
import { patientPath } from '@/features/patients/patientsRoutes';
import { useCurrentPractice, usePracticeCrumbs, usePracticeHref } from '@/features/practice/PracticeContext';
import { CLINICAL_TEXT_MAX, clinicalApi, TEST_OUTCOME_LABELS } from '@/lib/api/clinical';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import type { TestResult, TestResultListParams, TestResultOutcome } from '@/lib/api/types';
import { usePagedList, type PagedFetcher } from '@/lib/usePagedList';

export const outcomeTone = (outcome: TestResultOutcome | null) =>
  outcome === 'NORMAL' ? 'success' : outcome === 'BORDERLINE' ? 'warning' : outcome ? 'error' : 'neutral';

/** The result's values as a small table (release form and patient profile). */
export function ResultValues({ result }: { result: TestResult }) {
  return (
    <Table size="small" aria-label={`${result.name} values`}>
      <TableHead>
        <TableRow>
          <TableCell>Test</TableCell>
          <TableCell>Result</TableCell>
          <TableCell>Range</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {result.values.map((value) => (
          <TableRow key={value.name}>
            <TableCell>{value.name}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{value.value}</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>{value.range}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReleaseModal({
  practiceId,
  result,
  onClose,
  onReleased,
}: {
  practiceId: string;
  result: TestResult;
  onClose: () => void;
  onReleased: () => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const abnormal = result.outcome !== 'NORMAL';
  const schema = Yup.object({
    comment: abnormal
      ? Yup.string().trim().required('Comment is required').max(CLINICAL_TEXT_MAX)
      : Yup.string().max(CLINICAL_TEXT_MAX),
    reviewed: abnormal ? Yup.boolean().oneOf([true], 'Confirm you’ve reviewed this result') : Yup.boolean(),
  });

  return (
    <Formik
      initialValues={{ comment: abnormal ? '' : 'Normal, no action needed.', reviewed: false }}
      validationSchema={schema}
      validateOnMount
      onSubmit={async (values) => {
        try {
          await clinicalApi.releaseTestResult(
            PUBLIC_SUB_APP_ID,
            practiceId,
            result.id,
            values.comment.trim(),
            values.reviewed,
          );
          enqueueSnackbar('Released to the patient', { variant: 'success' });
          onReleased();
        } catch {
          enqueueSnackbar('Failed to release the result', { variant: 'error' });
        }
      }}
    >
      {(formik) => (
        <FormModal
          open
          title={`Release ${result.name}`}
          subtitle={`${result.patient_name} · taken ${dayjs(result.taken_at).format('DD/MM/YYYY')}`}
          onClose={onClose}
          onSubmit={formik.submitForm}
          submitLabel="Release to Patient"
          submitIcon={<Send />}
          submitDisabled={!formik.isValid}
          submitting={formik.isSubmitting}
        >
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="body2">Outcome:</Typography>
            <StatusChip
              status={result.outcome ? TEST_OUTCOME_LABELS[result.outcome] : 'Pending'}
              tone={outcomeTone(result.outcome)}
            />
          </Stack>
          <ResultValues result={result} />
          {abnormal && (
            <Alert severity="warning">
              This result isn’t normal, so it’s never released automatically. Explain the next steps for the patient.
            </Alert>
          )}
          <TextField
            fullWidth
            multiline
            minRows={3}
            required={abnormal}
            label="Comment for the patient"
            {...formik.getFieldProps('comment')}
            slotProps={{ htmlInput: { maxLength: CLINICAL_TEXT_MAX } }}
            error={formik.touched.comment && Boolean(formik.errors.comment)}
            helperText={formik.touched.comment && formik.errors.comment}
          />
          {abnormal && (
            <Box>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={formik.values.reviewed}
                    onChange={(event) => formik.setFieldValue('reviewed', event.target.checked)}
                  />
                }
                label={`I’ve reviewed this ${result.outcome === 'BORDERLINE' ? 'borderline' : 'abnormal'} result and the next steps are in my comment`}
              />
              {formik.touched.reviewed && formik.errors.reviewed && (
                <FormHelperText error>{String(formik.errors.reviewed)}</FormHelperText>
              )}
            </Box>
          )}
        </FormModal>
      )}
    </Formik>
  );
}

type Tab = 'release' | 'released';

/**
 * Test Results (sprint 16, docs/plans/sprint-16-modules.md §1): results from the clinical system wait
 * here until a clinician releases them to the patient. Abnormal results are never released
 * automatically and need a comment.
 */
export function TestResultsPage() {
  const practice = useCurrentPractice();
  const practiceHref = usePracticeHref();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = useSearchParams().get('tab') === 'released' ? 'released' : 'release';
  const [releasing, setReleasing] = useState<TestResult | null>(null);
  usePracticeCrumbs([{ label: 'Test Results' }]);

  const status = tab === 'release' ? 'AWAITING_RELEASE' : 'RELEASED';
  const fetcher = useCallback<PagedFetcher<TestResult>>(
    (params, signal) =>
      clinicalApi.testResults(PUBLIC_SUB_APP_ID, practice.id, { ...(params as TestResultListParams), status }, signal),
    [practice.id, status],
  );
  const list = usePagedList(fetcher, {
    pageSize: 10,
    errorText: 'Could not load test results.',
    errorToast: 'Failed to load test results',
  });

  const columns: DataTableColumn<TestResult>[] = [
    {
      id: 'patient',
      label: 'Patient Name',
      render: (result) => (
        <Box
          component={Link}
          href={`${practiceHref(patientPath(result.patient_id))}#results`}
          sx={{ color: 'text.primary', fontWeight: 500, whiteSpace: 'nowrap' }}
        >
          {result.patient_name}
        </Box>
      ),
    },
    {
      id: 'test',
      label: 'Test',
      render: (result) => (
        <Box sx={{ minWidth: 160 }}>
          {result.name}
          <Typography variant="caption" sx={{ display: 'block' }}>
            {result.source}
          </Typography>
        </Box>
      ),
    },
    { id: 'taken', label: 'Taken', render: (result) => dayjs(result.taken_at).format('DD/MM/YYYY') },
    {
      id: 'outcome',
      label: 'Outcome',
      render: (result) => (
        <StatusChip
          status={result.outcome ? TEST_OUTCOME_LABELS[result.outcome] : 'Pending'}
          tone={outcomeTone(result.outcome)}
        />
      ),
    },
    tab === 'release'
      ? {
          id: 'actions',
          label: 'Actions',
          align: 'center',
          render: (result) => (
            <Button size="small" variant="contained" onClick={() => setReleasing(result)} sx={{ whiteSpace: 'nowrap' }}>
              Review and Release
            </Button>
          ),
        }
      : {
          id: 'released',
          label: 'Released',
          render: (result) => (
            <Box sx={{ minWidth: 150 }}>
              {result.released_at ? dayjs(result.released_at).format('DD/MM/YYYY HH:mm') : '-'}
              <Typography variant="caption" sx={{ display: 'block' }}>
                {result.released_by}
              </Typography>
              {result.comment && (
                <Typography variant="caption" sx={{ display: 'block' }}>
                  “{result.comment}”
                </Typography>
              )}
            </Box>
          ),
        },
  ];

  const filtered = Boolean(list.query.search) || Object.values(list.query.filters).some(Boolean);

  return (
    <Stack spacing={2.5}>
      <Box>
        <SegmentedTabs<Tab>
          aria-label="Test result sections"
          tone="brand"
          value={tab}
          onChange={(next) =>
            router.replace(next === 'release' ? pathname : `${pathname}?tab=released`, { scroll: false })
          }
          items={[
            { value: 'release', label: 'To Release', icon: <Inbox /> },
            { value: 'released', label: 'Released', icon: <Outbox /> },
          ]}
        />
      </Box>
      <ModulePageHeader
        title="Test Results"
        subtitle="Results from the clinical system. Patients see a result only after you release it; abnormal results are never released automatically."
      />
      <FilterBar
        filters={[
          {
            id: 'outcome',
            label: 'Outcome',
            allLabel: 'All Outcomes',
            options: (Object.keys(TEST_OUTCOME_LABELS) as TestResultOutcome[]).map((outcome) => ({
              value: outcome,
              label: TEST_OUTCOME_LABELS[outcome],
            })),
          },
        ]}
        values={list.query.filters}
        onChange={list.setFilter}
        search={{ value: list.query.search, onChange: list.setSearch, placeholder: 'Search patient or test' }}
        onClear={list.clear}
      />
      <DataTable
        key={tab}
        aria-label={tab === 'release' ? 'Results to release' : 'Released results'}
        columns={columns}
        rows={list.rows}
        getRowId={(result) => result.id}
        page={list.query.page}
        rowsPerPage={list.query.pageSize}
        totalCount={list.count}
        onPageChange={list.setPage}
        onRowsPerPageChange={list.setPageSize}
        loading={list.loading}
        error={list.error}
        emptyMessage={
          filtered
            ? 'No results found. Try another search.'
            : tab === 'release'
              ? 'No results waiting for release.'
              : 'No released results yet.'
        }
        minWidth={800}
      />
      {releasing && (
        <ReleaseModal
          practiceId={practice.id}
          result={releasing}
          onClose={() => setReleasing(null)}
          onReleased={() => {
            setReleasing(null);
            list.reload();
          }}
        />
      )}
    </Stack>
  );
}
