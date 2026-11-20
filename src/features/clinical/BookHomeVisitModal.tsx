'use client';

import dayjs from 'dayjs';
import { Formik } from 'formik';
import { useSnackbar } from 'notistack';
import * as Yup from 'yup';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import { FormModal } from '@/components/modals/FormModal';
import { useAssignableStaff } from '@/features/tickets/components/AssignStaffModal';
import { CLINICAL_TEXT_MAX, clinicalApi, HOME_VISIT_WINDOW_LABELS } from '@/lib/api/clinical';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import type { HomeVisit, HomeVisitRequest, HomeVisitWindow, TicketStaff } from '@/lib/api/types';

interface Values {
  clinician_id: string;
  date: string;
  window: HomeVisitWindow | '';
  notes: string;
}

const schema = Yup.object({
  clinician_id: Yup.string().required('Clinician is required'),
  date: Yup.string()
    .required('Date is required')
    .test('future', 'Date can’t be in the past', (value) => !value || !dayjs(value).isBefore(dayjs(), 'day')),
  window: Yup.string().required('Time window is required'),
  notes: Yup.string().max(CLINICAL_TEXT_MAX, `Notes must be ${CLINICAL_TEXT_MAX} characters or fewer`),
});

/**
 * Book Home Visit (sprint 16, docs/plans/sprint-16-modules.md §6): the 600px form modal. The named or
 * recommended clinician is listed first; the date can't be in the past.
 */
export function BookHomeVisitModal({
  open,
  practiceId,
  request,
  preferred,
  onClose,
  onBooked,
}: {
  open: boolean;
  practiceId: string;
  request: HomeVisitRequest;
  /** The consultation's assigned or recommended clinician, listed first. */
  preferred: TicketStaff | null;
  onClose: () => void;
  onBooked: (visit: HomeVisit) => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const staff = useAssignableStaff(practiceId, open) ?? [];
  const ordered = preferred ? [preferred, ...staff.filter((member) => member.id !== preferred.id)] : staff;

  return (
    <Formik<Values>
      key={open ? 'open' : 'closed'}
      initialValues={{
        clinician_id: preferred?.id ?? '',
        date: dayjs().format('YYYY-MM-DD'),
        window: 'AFTERNOON',
        notes: '',
      }}
      validationSchema={schema}
      validateOnMount
      onSubmit={async (values) => {
        try {
          const visit = await clinicalApi.bookHomeVisit(PUBLIC_SUB_APP_ID, practiceId, {
            ticket_id: request.ticket_id,
            clinician_id: values.clinician_id,
            date: values.date,
            window: values.window as HomeVisitWindow,
            notes: values.notes.trim(),
          });
          enqueueSnackbar('Home visit booked', { variant: 'success' });
          onBooked(visit);
        } catch {
          enqueueSnackbar('Failed to book the home visit', { variant: 'error' });
        }
      }}
    >
      {(formik) => {
        const error = (name: keyof Values) =>
          formik.touched[name] && formik.errors[name] ? String(formik.errors[name]) : undefined;
        return (
          <FormModal
            open={open}
            title="Book Home Visit"
            subtitle={`${request.patient_name} · ${request.reason}`}
            onClose={onClose}
            onSubmit={formik.submitForm}
            submitLabel="Book Home Visit"
            submitIcon={<HomeOutlined />}
            submitDisabled={!formik.isValid}
            submitting={formik.isSubmitting}
          >
            <TextField
              select
              fullWidth
              required
              label="Clinician"
              {...formik.getFieldProps('clinician_id')}
              error={Boolean(error('clinician_id'))}
              helperText={error('clinician_id')}
            >
              {ordered.map((member, index) => (
                <MenuItem key={member.id} value={member.id}>
                  {member.name} · {member.role}
                  {index === 0 && preferred ? ' (named clinician)' : ''}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              fullWidth
              required
              type="date"
              label="Date"
              {...formik.getFieldProps('date')}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: dayjs().format('YYYY-MM-DD') } }}
              error={Boolean(error('date'))}
              helperText={error('date')}
            />
            <TextField
              select
              fullWidth
              required
              label="Time window"
              {...formik.getFieldProps('window')}
              error={Boolean(error('window'))}
              helperText={error('window')}
            >
              {(Object.keys(HOME_VISIT_WINDOW_LABELS) as HomeVisitWindow[]).map((window) => (
                <MenuItem key={window} value={window}>
                  {HOME_VISIT_WINDOW_LABELS[window]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              fullWidth
              multiline
              minRows={3}
              label="Notes"
              placeholder="e.g. Key safe code given by phone"
              {...formik.getFieldProps('notes')}
              slotProps={{ htmlInput: { maxLength: CLINICAL_TEXT_MAX } }}
              error={Boolean(error('notes'))}
              helperText={error('notes')}
            />
          </FormModal>
        );
      }}
    </Formik>
  );
}
