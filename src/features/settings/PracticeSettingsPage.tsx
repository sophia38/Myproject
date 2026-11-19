'use client';

import { SettingsShell } from '@/components/layout/SettingsShell';
import { PRACTICE_SETTINGS_SECTIONS } from '@/config/practiceSettings';
import { useCurrentPractice, usePracticeCrumbs, usePracticeHref } from '@/features/practice/PracticeContext';
import { TemplateLibraryPage } from '@/features/templates/TemplateLibraryPage';
import { CompetencySection } from './CompetencySection';
import { GlobalAppointmentConfigSection } from './GlobalAppointmentConfigSection';
import { PathwaySection } from './PathwaySection';
import { PracticeProfileSection } from './PracticeProfileSection';

type SectionSlug = (typeof PRACTICE_SETTINGS_SECTIONS)[number]['slug'];

const SUBTITLES: Record<SectionSlug, string | undefined> = {
  // Live: "Manage Appointment settings here." (capital A).
  'appointment-configuration': 'Manage appointment settings here.',
  competency: 'Manage clinical competency categories and sub-types used for staff assignment and task routing.',
  'pathway-configuration': "Manage this practice's pathway configuration here.",
  'practice-profile': 'Your practice’s details, contacts, opening hours and configuration.',
  templates: 'Manage the message, email and note templates staff use.',
};

/**
 * Practice Settings (docs/practice/08-hr-policies-and-settings.md §2, plan §8): the vertical sections
 * scoped to the practice, as path routes (`settings/{section}`), under the breadcrumb `Settings / {Section}`.
 */
export function PracticeSettingsPage({ section }: { section: string }) {
  const practice = useCurrentPractice();
  const practiceHref = usePracticeHref();
  const current = PRACTICE_SETTINGS_SECTIONS.find((item) => item.slug === section) ?? PRACTICE_SETTINGS_SECTIONS[0];
  const hrefFor = (slug: string) => practiceHref(`/settings/${slug}`);
  usePracticeCrumbs([
    { label: 'Settings', href: hrefFor(PRACTICE_SETTINGS_SECTIONS[0].slug) },
    { label: current.label },
  ]);

  const shell = {
    sections: PRACTICE_SETTINGS_SECTIONS.map(({ slug, label }) => ({ key: slug, label })),
    active: current.slug,
    hrefFor,
    title: current.label,
  };

  // Practice Profile owns its form, so it renders the shell itself (Save Changes sits in the header).
  if (current.slug === 'practice-profile') {
    return <PracticeProfileSection key={practice.id} practiceId={practice.id} shell={shell} />;
  }

  return (
    <SettingsShell {...shell} subtitle={SUBTITLES[current.slug]}>
      {/* Keyed by practice, so switching practice starts the section again. */}
      {current.slug === 'appointment-configuration' && (
        <GlobalAppointmentConfigSection key={practice.id} practiceId={practice.id} />
      )}
      {current.slug === 'competency' && <CompetencySection key={practice.id} practiceId={practice.id} />}
      {current.slug === 'pathway-configuration' && <PathwaySection key={practice.id} practiceId={practice.id} />}
      {current.slug === 'templates' && <TemplateLibraryPage embedded />}
    </SettingsShell>
  );
}
