'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import EventBusy from '@mui/icons-material/EventBusyOutlined';
import Inbox from '@mui/icons-material/InboxOutlined';
import Outbox from '@mui/icons-material/OutboxOutlined';
import PlaylistAdd from '@mui/icons-material/PlaylistAddOutlined';
import Sms from '@mui/icons-material/SmsOutlined';
import { ModulePageHeader } from '@/components/layout/ModulePageHeader';
import { SegmentedTabs } from '@/components/navigation/SegmentedTabs';
import { usePracticeCrumbs } from '@/features/practice/PracticeContext';
import { AppointmentRequestsTab } from './AppointmentRequestsTab';
import { AppointmentsTab } from './AppointmentsTab';
import { CancelledAppointmentsTab } from './CancelledAppointmentsTab';
import { CancelRequestsTab } from './CancelRequestsTab';
import { WaitingListTab } from './WaitingListTab';

type Tab = 'appointments' | 'requests' | 'cancelled' | 'cancel-requests' | 'waiting-list';

const TABS: { value: Tab; label: string; icon: React.ReactNode; title: string; subtitle: string }[] = [
  {
    value: 'appointments',
    label: 'Appointment',
    icon: <Inbox />,
    title: 'Appointment',
    subtitle: 'Manage and schedule patient appointments',
  },
  {
    value: 'requests',
    label: 'Appointment Requests',
    icon: <Outbox />,
    title: 'Appointment Requests',
    subtitle: 'Review requests to book a different staff member.',
  },
  {
    value: 'cancelled',
    label: 'Cancelled Appointments',
    icon: <EventBusy />,
    title: 'Cancelled Appointments',
    subtitle: 'Slots released by patient cancellations, newest first. Offer each one to the next patient waiting.',
  },
  {
    value: 'cancel-requests',
    label: 'Cancel Requests',
    icon: <Sms />,
    title: 'Cancel Requests',
    subtitle: 'Patients who replied CANCEL to a reminder. Check each one before cancelling.',
  },
  {
    value: 'waiting-list',
    label: 'Waiting List',
    icon: <PlaylistAdd />,
    title: 'Waiting List',
    subtitle: 'Routine appointments to book within 1 or 2 weeks.',
  },
];

/**
 * Appointment (docs/practice/03-appointment.md, plan §3; sprint 16 adds Cancelled Appointments,
 * Cancel Requests and Waiting List). The tab is kept in `?tab=` so it can be linked (live keeps it
 * in page state), and each tab has its own header (fixes the reused live header).
 */
export function AppointmentPage() {
  const router = useRouter();
  const pathname = usePathname();
  const requested = useSearchParams().get('tab');
  const tab: Tab = TABS.some((item) => item.value === requested) ? (requested as Tab) : 'appointments';
  const current = TABS.find((item) => item.value === tab) ?? TABS[0];
  usePracticeCrumbs([{ label: 'Appointment' }]);

  return (
    <Stack spacing={2.5}>
      <Box sx={{ overflowX: 'auto' }}>
        <SegmentedTabs<Tab>
          aria-label="Appointment sections"
          tone="brand"
          value={tab}
          onChange={(next) =>
            router.replace(next === 'appointments' ? pathname : `${pathname}?tab=${next}`, { scroll: false })
          }
          items={TABS.map(({ value, label, icon }) => ({ value, label, icon }))}
        />
      </Box>
      <ModulePageHeader title={current.title} subtitle={current.subtitle} />
      {tab === 'appointments' && <AppointmentsTab />}
      {tab === 'requests' && <AppointmentRequestsTab />}
      {tab === 'cancelled' && <CancelledAppointmentsTab />}
      {tab === 'cancel-requests' && <CancelRequestsTab />}
      {tab === 'waiting-list' && <WaitingListTab />}
    </Stack>
  );
}
