'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormikHelpers } from 'formik';
import { useSnackbar } from 'notistack';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import { fieldErrors, practiceManagementApi } from '@/lib/api/practiceManagement';
import type { Practice, Role } from '@/lib/api/types';
import { usersApi } from '@/lib/api/users';
import { focusFirstError } from './formHelpers';
import { profileFromApi, profileToApi, type ProfileValues } from './practiceForm';

export type LoadedProfile = {
  practice: Practice;
  values: ProfileValues;
  roles: Role[];
  practiceOptions: { id: string; practice_name: string }[];
};

export type ProfileState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; loaded: LoadedProfile };

/** Every practice the user can see (the API caps pages at 100), for the Linked Practices picker. */
async function allPractices(subAppId: string, signal: AbortSignal) {
  const all: Practice[] = [];
  for (let page = 1; ; page++) {
    const result = await practiceManagementApi.practices(subAppId, { page, page_size: 100 }, signal);
    all.push(...result.results);
    if (!result.next) return all;
  }
}

/**
 * Loads and saves a practice profile: the practice (onboarding details), its appointment
 * configuration and its SLA configuration. Shared by the super-admin's Complete Practice Profile
 * and Practice Settings → Practice Profile, so both show and save the same data.
 */
export function usePracticeProfile(practiceId: string, subAppId: string = PUBLIC_SUB_APP_ID) {
  const { enqueueSnackbar } = useSnackbar();
  const [state, setState] = useState<ProfileState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!practiceId) return;
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      practiceManagementApi.practice(subAppId, practiceId, signal),
      practiceManagementApi.appointmentConfiguration(subAppId, practiceId, signal),
      practiceManagementApi.slaConfiguration(subAppId, practiceId, signal),
      // The unpaged list: practice users may read it (the paged Role Management list is super-admin only).
      usersApi.allRoles(subAppId, signal),
      allPractices(subAppId, signal),
    ])
      .then(([practice, appointment, sla, roles, practices]) => {
        // The live page also fires this lookup on load; its result isn't shown on screen.
        void practiceManagementApi.sameRotaPractices(subAppId, practiceId).catch(() => undefined);
        setState({
          status: 'ready',
          loaded: {
            practice,
            values: profileFromApi(practice, appointment, sla),
            roles,
            practiceOptions: practices.map(({ id, practice_name }) => ({ id, practice_name })),
          },
        });
      })
      .catch(() => {
        if (!signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [practiceId, subAppId, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  /** One Save Changes saves the practice, its appointment configuration and its SLA configuration. */
  const save = useCallback(
    async (values: ProfileValues, helpers: FormikHelpers<ProfileValues>) => {
      const { input, appointment, sla } = profileToApi(values);
      const results = await Promise.allSettled([
        practiceManagementApi.updatePractice(subAppId, practiceId, input),
        practiceManagementApi.saveAppointmentConfiguration(subAppId, practiceId, appointment),
        practiceManagementApi.saveSlaConfiguration(subAppId, practiceId, sla),
      ]);
      const failed = ['practice details', 'appointment configuration', 'urgent capacity settings'].filter(
        (_, index) => results[index].status === 'rejected',
      );
      if (failed.length === 0) {
        enqueueSnackbar('Practice profile updated successfully', { variant: 'success' });
        helpers.resetForm({ values });
        return true;
      }
      const first = results.find((result) => result.status === 'rejected');
      const errors = first?.status === 'rejected' ? fieldErrors(first.reason) : {};
      if (Object.keys(errors).length) {
        helpers.setErrors(errors);
        focusFirstError();
      }
      enqueueSnackbar(`Failed to save ${failed.join(' and ')}`, { variant: 'error' });
      return false;
    },
    [enqueueSnackbar, practiceId, subAppId],
  );

  return { state, retry, save };
}
