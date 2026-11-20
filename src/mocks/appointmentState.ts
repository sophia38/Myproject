import { assignableStaff } from './fixtures/tickets';
import {
  appointmentsOn,
  clockStatus,
  dateOfAppointmentId,
  type AppointmentContext,
  type AppointmentSeed,
} from './fixtures/appointments';
import type { Appointment, AppointmentStatus } from '@/lib/api/types';
import { getDb, saveDb } from './store';

// Appointments aren't stored: each day's list is worked out from the date (fixtures/appointments.ts)
// and demo changes are laid over it. Shared by the appointment and waiting-list mocks.

export function contextFor(practiceId: string): AppointmentContext | null {
  const db = getDb();
  const practice = db.practices.find((item) => item.id === practiceId);
  if (!practice) return null;
  return {
    practice,
    tickets: db.tickets.filter((ticket) => ticket.practice_id === practiceId),
    patients: new Map(db.patients.filter((item) => item.practice_id === practiceId).map((item) => [item.id, item])),
    staff: assignableStaff(db.staff, db.roles, practiceId),
  };
}

export const changeKey = (practiceId: string, appointmentId: string) => `${practiceId}:${appointmentId}`;

/** The appointment as shown: the clock status, unless it was changed in the demo. */
export function present(seed: AppointmentSeed): Appointment {
  const rest: Omit<AppointmentSeed, 'seeded_status'> & { seeded_status?: unknown } = { ...seed };
  delete rest.seeded_status;
  const change = getDb().appointmentChanges[changeKey(seed.practice_id, seed.id)];
  if (!change) return { ...rest, status: clockStatus(seed) };
  // A released slot booked for a waiting patient: the appointment is theirs and follows the clock again.
  if (change.rebooked) {
    const { rebooked } = change;
    const timed = clockStatus({ ...seed, seeded_status: null });
    return {
      ...rest,
      patient_id: rebooked.patient_id,
      patient_name: rebooked.patient_name,
      patient_phone: rebooked.patient_phone,
      patient_email: rebooked.patient_email,
      request_name: rebooked.request_name,
      cancellation_reason: null,
      status: timed,
    };
  }
  return { ...rest, status: change.status, cancellation_reason: change.reason ?? rest.cancellation_reason };
}

export function findAppointment(practiceId: string, appointmentId: string) {
  const date = dateOfAppointmentId(appointmentId);
  const context = contextFor(practiceId);
  if (!date || !context) return null;
  return appointmentsOn(context, date).find((item) => item.id === appointmentId) ?? null;
}

/** Saves a change and returns the updated appointment. */
export function change(seed: AppointmentSeed, status: AppointmentStatus, reason: string | null = null) {
  getDb().appointmentChanges[changeKey(seed.practice_id, seed.id)] = { status, reason };
  saveDb();
  return present(seed);
}
