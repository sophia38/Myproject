import { expect as baseExpect, test, type Page } from '@playwright/test';

// These pages load several lists at once; allow for a slow machine.
const expect = baseExpect.configure({ timeout: 30_000 });

// Sprint 16: cancellations and automatic waitlist filling (docs/plans/sprint-16-modules.md §5).
const PRACTICE = '/verticals/public/practices/ashford-medical-centre';
const APPOINTMENT = `${PRACTICE}/appointment/`;

async function logIn(page: Page) {
  await page.goto('/auth/login/');
  await page.getByLabel('Email').fill('reviewer@aqlios.demo');
  await page.getByLabel('Password', { exact: true }).fill('demo');
  await page.getByRole('radio', { name: 'Practice user (GP)' }).check();
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL(/\/verticals\//);
}

const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();
const slots = (page: Page) => page.getByRole('table', { name: 'Cancelled appointments' });
const slotRow = (page: Page, patient: string) => slots(page).getByRole('row', { name: new RegExp(patient) });

test.describe('cancellations and waiting list', () => {
  test('offer a released slot: approval, patient reply, booked', async ({ page }) => {
    await logIn(page);
    await page.goto(`${APPOINTMENT}?tab=cancelled`);
    await expect(page.getByRole('heading', { name: 'Cancelled Appointments' })).toBeVisible();
    // Seeded: Arthur cancelled more than 24 hours ahead and is a frequent canceller.
    const row = slotRow(page, 'Arthur James Fairbairn');
    await expect(row).toContainText('Frequent canceller');
    await expect(row).toContainText('Needs Offering');

    await row.getByRole('button', { name: 'Offer Slot' }).click();
    const drawer = page.getByRole('dialog', { name: 'Next in Line' });
    await expect(drawer).toContainText('Practice manager approval is on');
    // 1-week list first: Amelia, then Rosie. Skip shows the next patient.
    await drawer.getByRole('button', { name: 'Skip' }).click();
    await expect(toast(page, /Skipped Amelia Ashworth/)).toBeVisible();
    await drawer.getByRole('button', { name: 'Offer', exact: true }).first().click();
    await expect(toast(page, 'Sent to the practice manager for approval')).toBeVisible();
    await expect(row).toContainText('Awaiting Approval');
    await expect(row).toContainText('Offer to Rosie Grace Kendrick');

    await row.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Approve Offer' }).getByRole('button', { name: 'Approve' }).click();
    await expect(toast(page, 'Approved. Offer sent to Rosie Grace Kendrick')).toBeVisible();
    await expect(row).toContainText('Offered');
    await expect(row).toContainText('held until');

    await row.getByRole('button', { name: /^View released slot/ }).click();
    const details = page.getByRole('dialog', { name: 'Released Slot' });
    await details.getByRole('button', { name: 'Accepted' }).click();
    await expect(toast(page, 'Booked for Rosie Grace Kendrick')).toBeVisible();
    await expect(details).toContainText('Rosie Grace Kendrick accepted. Appointment booked.');
    await page.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await expect(row).toContainText('Booked');

    // Rosie is off the waiting list.
    await page.getByRole('tab', { name: 'Waiting List' }).click();
    await expect(page.getByRole('table', { name: 'Waiting list' }).getByRole('row', { name: /Rosie/ })).toContainText(
      'Booked',
    );
  });

  test('a rejected choice goes back to be offered again', async ({ page }) => {
    await logIn(page);
    await page.goto(`${APPOINTMENT}?tab=cancelled`);
    const row = slotRow(page, 'Arthur James Fairbairn');
    await row.getByRole('button', { name: 'Offer Slot' }).click();
    await page
      .getByRole('dialog', { name: 'Next in Line' })
      .getByRole('button', { name: 'Offer', exact: true })
      .first()
      .click();
    await row.getByRole('button', { name: 'Reject' }).click();
    const reject = page.getByRole('dialog', { name: 'Reject Offer' });
    await expect(reject.getByRole('button', { name: 'Reject' })).toBeDisabled();
    await reject.getByRole('textbox', { name: 'Reason' }).fill('Amelia is better seen by her named GP.');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(toast(page, 'Rejected. The slot can be offered again')).toBeVisible();
    await expect(row).toContainText('Needs Offering');
    await expect(row).toContainText('Next in line: Rosie Grace Kendrick');
  });

  test('within 24 hours the slot goes to the first patients in line', async ({ page }) => {
    await logIn(page);
    await page.goto(`${APPOINTMENT}?tab=cancelled`);
    // Wait for the table: whether a slot is within 24 hours depends on the time of day.
    await expect(slotRow(page, 'Arthur James Fairbairn')).toBeVisible();
    const soon = slots(page)
      .getByRole('row', { name: /Within 24 hours/ })
      .first();
    test.skip((await soon.count()) === 0, 'No appointment within the next 24 hours today');
    await soon.getByRole('button', { name: 'Offer Slot' }).click();
    const drawer = page.getByRole('dialog', { name: 'Next in Line' });
    await expect(drawer).toContainText('no hold');
    await drawer.getByRole('button', { name: /^Offer to First \d in Line$/ }).click();
    await expect(toast(page, /Offer sent to \d patients/)).toBeVisible();
    await expect(slots(page)).toContainText('First to Accept');
  });

  test('a reply-CANCEL request releases the slot; the waiting list takes new patients', async ({ page }) => {
    await logIn(page);
    await page.goto(`${APPOINTMENT}?tab=cancel-requests`);
    const requests = page.getByRole('table', { name: 'Cancel requests' });
    await expect(requests).toContainText('“CANCEL”');
    await requests.getByRole('button', { name: 'Cancel Appointment' }).click();
    await page
      .getByRole('dialog', { name: 'Cancel Appointment' })
      .getByRole('button', { name: 'Cancel Appointment' })
      .click();
    await expect(toast(page, 'Appointment cancelled. The slot is in Cancelled Appointments')).toBeVisible();
    await expect(requests).toContainText('Cancelled');

    await page.getByRole('tab', { name: 'Cancelled Appointments' }).click();
    await expect(slots(page)).toContainText('Reply to reminder');

    await page.getByRole('tab', { name: 'Waiting List' }).click();
    await page.getByRole('button', { name: 'Add to Waiting List' }).click();
    const modal = page.getByRole('dialog', { name: 'Add to Waiting List' });
    await expect(modal.getByRole('button', { name: 'Add to Waiting List' })).toBeDisabled();
    await modal.getByLabel(/^Patient/).click();
    // Arthur cancelled his own slot and isn't waiting (the seeded list already has Harry and others).
    await page.getByRole('option', { name: 'Arthur James Fairbairn' }).click();
    await modal.getByLabel(/^Due window/).click();
    await page.getByRole('option', { name: 'Within 1 week' }).click();
    await modal.getByLabel(/^Reason/).fill('Asthma review');
    await modal.getByRole('button', { name: 'Add to Waiting List' }).click();
    await expect(toast(page, 'Added to the waiting list')).toBeVisible();
    await expect(page.getByRole('table', { name: 'Waiting list' })).toContainText('Arthur James Fairbairn');
  });

  test('frequent-canceller markers and their settings', async ({ page }) => {
    await logIn(page);
    await page.goto(`${APPOINTMENT}?tab=cancelled`);
    await expect(slotRow(page, 'Arthur James Fairbairn')).toContainText('Frequent canceller');

    await page.goto(`${PRACTICE}/settings/appointment-configuration/`);
    const red = page.getByLabel(/Red “Frequent canceller” from/);
    await red.fill('2');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('The red marker must start above the amber one')).toBeVisible();
    await red.fill('8');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(toast(page, /updated successfully/)).toBeVisible();

    // Arthur has 6: now only the amber marker.
    await page.goto(`${APPOINTMENT}?tab=cancelled`);
    await expect(slotRow(page, 'Arthur James Fairbairn')).toContainText('6 cancellations');
  });
});
