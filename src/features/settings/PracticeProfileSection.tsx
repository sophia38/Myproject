'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Formik, useFormikContext, type FormikErrors } from 'formik';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { LoadingSpinner } from '@/components/feedback/LoadingSpinner';
import { LogoUploadDropzone } from '@/components/forms/LogoUploadDropzone';
import { SettingsShell, type SettingsShellProps } from '@/components/layout/SettingsShell';
import { PillTabs } from '@/components/navigation/PillTabs';
import { AdditionalConfigurationSections } from '@/features/practices/AdditionalConfigurationSections';
import { PracticeDetailsSections } from '@/features/practices/PracticeDetailsSections';
import { focusFirstError, useNameAvailability } from '@/features/practices/formHelpers';
import { profileSchema, sectionOf, type ProfileValues } from '@/features/practices/practiceForm';
import { usePracticeProfile, type LoadedProfile } from '@/features/practices/usePracticeProfile';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import { practiceManagementApi } from '@/lib/api/practiceManagement';
import { formatDate } from '@/lib/format';
import { LoadFailed } from './LoadFailed';

type ProfileTab = 'details' | 'contacts' | 'hours' | 'configuration';

const TABS: { value: ProfileTab; label: string }[] = [
  { value: 'details', label: 'Practice Details' },
  { value: 'contacts', label: 'Point of Contact' },
  { value: 'hours', label: 'Operating Hours' },
  { value: 'configuration', label: 'Practice Configuration' },
];

/** Which tab holds an error field (fields outside the four detail sections are configuration). */
function tabOf(field: string): ProfileTab {
  const section = sectionOf(field);
  if (section === 'details' || section === 'address') return 'details';
  if (section === 'contacts') return 'contacts';
  if (section === 'hours') return 'hours';
  return 'configuration';
}

function tabsWithErrors(errors: FormikErrors<ProfileValues>): Set<ProfileTab> {
  return new Set(
    Object.entries(errors)
      .filter(([, error]) => Boolean(error))
      .map(([field]) => tabOf(field)),
  );
}

const SUBTITLE = 'Your practice’s details, contacts, opening hours and configuration.';

type ShellProps = Pick<SettingsShellProps, 'sections' | 'active' | 'hrefFor' | 'title'>;

function ProfileForm({ loaded, shell }: { loaded: LoadedProfile; shell: ShellProps }) {
  const formik = useFormikContext<ProfileValues>();
  const { values, errors, submitCount, isSubmitting, dirty, handleSubmit, resetForm, setFieldValue } = formik;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  const tab: ProfileTab = TABS.some((item) => item.value === requested) ? (requested as ProfileTab) : 'details';
  const nameStatus = useNameAvailability(values.practice_name, loaded.practice.id, loaded.practice.practice_name);

  const setTab = (next: ProfileTab) => router.replace(`${pathname}?tab=${next}`, { scroll: false });

  // After a failed Save, open the first tab with an error and focus its first invalid field.
  const handled = useRef(0);
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (submitCount > handled.current && !isSubmitting) {
      handled.current = submitCount;
      const bad = tabsWithErrors(errors);
      if (bad.size) {
        const first = TABS.find((item) => bad.has(item.value))?.value;
        if (first && first !== tab) setTab(first);
        pendingFocus.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per submit
  }, [submitCount, isSubmitting]);
  useEffect(() => {
    if (pendingFocus.current) {
      pendingFocus.current = false;
      focusFirstError();
    }
  }, [tab, submitCount]);

  const errorTabs = submitCount > 0 ? tabsWithErrors(errors) : new Set<ProfileTab>();

  return (
    <Box component="form" noValidate onSubmit={handleSubmit}>
      <SettingsShell
        {...shell}
        subtitle={SUBTITLE}
        actions={
          <>
            <Button variant="outlined" disabled={!dirty || isSubmitting} onClick={() => resetForm()}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <Stack spacing={2.5}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Added during onboarding on {formatDate(loaded.practice.created_at)}. Changes here also update this practice
            in Practice Management.
            {dirty && (
              <Box component="span" sx={{ ml: 1, color: 'warning.dark', fontWeight: 600 }}>
                Unsaved changes
              </Box>
            )}
          </Typography>
          <PillTabs
            aria-label="Practice Profile"
            tabs={TABS.map((item) => ({ ...item, hasError: errorTabs.has(item.value) }))}
            value={tab}
            onChange={setTab}
          />
          <Box role="tabpanel" aria-label={TABS.find((item) => item.value === tab)?.label}>
            {tab === 'details' && (
              <Stack spacing={2.5}>
                <LogoUploadDropzone
                  value={values.logo_url}
                  practiceName={values.practice_name}
                  onUpload={async (file) => (await practiceManagementApi.uploadLogo(PUBLIC_SUB_APP_ID, file)).logo_url}
                  onChange={(url) => setFieldValue('logo_url', url)}
                />
                <PracticeDetailsSections
                  mode="profile"
                  nameStatus={nameStatus}
                  defaultExpanded
                  sections={['details', 'address']}
                  managerReadOnly
                />
              </Stack>
            )}
            {tab === 'contacts' && (
              <PracticeDetailsSections mode="profile" nameStatus={nameStatus} defaultExpanded sections={['contacts']} />
            )}
            {tab === 'hours' && (
              <PracticeDetailsSections mode="profile" nameStatus={nameStatus} defaultExpanded sections={['hours']} />
            )}
            {tab === 'configuration' && (
              <AdditionalConfigurationSections
                subAppId={PUBLIC_SUB_APP_ID}
                currentPracticeId={loaded.practice.id}
                practiceOptions={loaded.practiceOptions}
                roles={loaded.roles}
                showDivider={false}
              />
            )}
          </Box>
        </Stack>
      </SettingsShell>
    </Box>
  );
}

/**
 * Practice Settings → Practice Profile: the details entered when the practice was onboarded,
 * in four tabs (Practice Details, Point of Contact, Operating Hours, Practice Configuration).
 * Same fields, rules and APIs as the super-admin's Complete Practice Profile; unsaved edits are
 * kept across tabs and one Save Changes saves them all.
 */
export function PracticeProfileSection({ practiceId, shell }: { practiceId: string; shell: ShellProps }) {
  const { state, retry, save } = usePracticeProfile(practiceId);

  if (state.status !== 'ready') {
    return (
      <SettingsShell {...shell} subtitle={SUBTITLE}>
        {state.status === 'loading' ? (
          <LoadingSpinner message="Loading practice profile..." />
        ) : (
          <LoadFailed what="practice profile" onRetry={retry} />
        )}
      </SettingsShell>
    );
  }

  return (
    <Formik<ProfileValues>
      initialValues={state.loaded.values}
      validationSchema={profileSchema}
      validateOnBlur
      enableReinitialize
      onSubmit={async (values, helpers) => {
        await save(values, helpers);
      }}
    >
      <ProfileForm loaded={state.loaded} shell={shell} />
    </Formik>
  );
}
