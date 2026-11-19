'use client';

import { useSearchParams } from 'next/navigation';
import { Formik, useFormikContext } from 'formik';
import Stack from '@mui/material/Stack';
import { AccessDenied } from '@/components/feedback/AccessDenied';
import { LoadingSpinner } from '@/components/feedback/LoadingSpinner';
import { LogoUploadDropzone } from '@/components/forms/LogoUploadDropzone';
import { HubManagementLayout } from '@/components/layout/HubManagementLayout';
import { PUBLIC_SUB_APP_ID } from '@/lib/api/config';
import { practiceManagementApi } from '@/lib/api/practiceManagement';
import { AdditionalConfigurationSections } from './AdditionalConfigurationSections';
import { PracticeDetailsSections } from './PracticeDetailsSections';
import { PRACTICE_LIST_HREF, PracticeFormFrame } from './PracticeFormFrame';
import { useNameAvailability } from './formHelpers';
import { profileSchema, type ProfileValues } from './practiceForm';
import { usePracticeProfile, type LoadedProfile } from './usePracticeProfile';

function ProfileBody({ loaded }: { loaded: LoadedProfile }) {
  const { values, setFieldValue } = useFormikContext<ProfileValues>();
  // A taken name is shown on the field; the server also rejects it on save.
  const nameStatus = useNameAvailability(values.practice_name, loaded.practice.id, loaded.practice.practice_name);

  return (
    <Stack spacing={2.5}>
      <LogoUploadDropzone
        value={values.logo_url}
        practiceName={values.practice_name}
        onUpload={async (file) => (await practiceManagementApi.uploadLogo(PUBLIC_SUB_APP_ID, file)).logo_url}
        onChange={(url) => setFieldValue('logo_url', url)}
      />
      <PracticeDetailsSections mode="profile" nameStatus={nameStatus} defaultExpanded={false} />
      <AdditionalConfigurationSections
        subAppId={PUBLIC_SUB_APP_ID}
        currentPracticeId={loaded.practice.id}
        practiceOptions={loaded.practiceOptions}
        roles={loaded.roles}
      />
    </Stack>
  );
}

/**
 * Practice View / Complete Practice Profile (docs/super-admin/04-practice-profile.md). Opened from
 * 👁 in Practice Management and after onboarding. One Save Changes saves the practice, its
 * appointment configuration and its SLA configuration.
 */
export function PracticeProfilePage() {
  const searchParams = useSearchParams();
  const practiceId = searchParams.get('practiceId') ?? '';
  const subAppId = searchParams.get('subAppId') ?? PUBLIC_SUB_APP_ID;
  const { state, save } = usePracticeProfile(practiceId, subAppId);

  const crumbs = [{ label: 'Practice Management', href: PRACTICE_LIST_HREF }, { label: 'Complete Practice Profile' }];

  if (!practiceId || state.status === 'error') {
    return (
      <HubManagementLayout hubManagementBreadcrumbs={crumbs}>
        <AccessDenied
          title="Practice not found or you don't have access"
          message="Check the link, or open the practice from Practice Management."
          backHref={PRACTICE_LIST_HREF}
          backLabel="Go to Practice Management"
        />
      </HubManagementLayout>
    );
  }
  if (state.status === 'loading') {
    return (
      <HubManagementLayout hubManagementBreadcrumbs={crumbs}>
        <LoadingSpinner message="Loading practice profile..." />
      </HubManagementLayout>
    );
  }

  const { loaded } = state;
  return (
    <Formik<ProfileValues>
      initialValues={loaded.values}
      validationSchema={profileSchema}
      validateOnBlur
      enableReinitialize
      onSubmit={async (values, helpers) => {
        await save(values, helpers);
      }}
    >
      <PracticeFormFrame
        crumbs={crumbs}
        subtitle="Update practice information, upload your logo, and configure additional settings."
      >
        <ProfileBody loaded={loaded} />
      </PracticeFormFrame>
    </Formik>
  );
}
