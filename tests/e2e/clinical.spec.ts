import { expect as baseExpect, test, type Page } from '@playwright/test';

// Sprint 16 clinical: home visits, test results, patient health and letter requests.
const expect = baseExpect.configure({ timeout: 20_000 });
const PRACTICE = '/verticals/public/practices/ashford-medical-centre';

async function logIn(page: Page) {
  await page.goto('/auth/login/');
  await page.getByLabel('Email').fill('reviewer@aqlios.demo');
  await page.getByLabel('Password', { exact: true }).fill('demo');
  await page.getByRole('radio', { name: 'Practice user (GP)' }).check();
  await page.getByRole('button', { name: 'Log In' }).click();
  await expect(page).toHaveURL(/\/verticals\//);
}

const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();

test.describe('clinical', () => {
  test('book a home visit from the consultation, then complete it', async ({ page }) => {
    await logIn(page);
    await page.goto(`${PRACTICE}/consultations-review/`);
    await expect(page.getByText('Home visit', { exact: true }).first()).toBeVisible();

    await page.goto(`${PRACTICE}/home-visits/`);
    await expect(page.getByRole('heading', { name: 'Home Visits' })).toBeVisible();
    await page.getByRole('link', { name: 'Open consultation to book' }).first().click();
    await expect(page.getByText('Home visit needed')).toBeVisible();
    await page.getByRole('button', { name: 'Book Home Visit' }).click();
    const modal = page.getByRole('dialog', { name: 'Book Home Visit' });
    await modal.getByLabel(/^Date/).fill('2020-01-01');
    // A past date keeps the form invalid.
    await expect(modal.getByRole('button', { name: 'Book Home Visit' })).toBeDisabled();
    await modal.getByLabel(/^Date/).fill('2030-01-07');
    await modal.getByRole('button', { name: 'Book Home Visit' }).click();
    await expect(toast(page, 'Home visit booked')).toBeVisible();
    await expect(page.getByText(/07\/01\/2030/)).toBeVisible();

    await page.getByRole('link', { name: 'View Home Visits' }).click();
    const table = page.getByRole('table', { name: 'Home visits' });
    await expect(table).toContainText('07/01/2030');
    await table.getByRole('button', { name: 'Mark Completed' }).first().click();
    await page
      .getByRole('dialog', { name: 'Mark as Completed' })
      .getByRole('button', { name: 'Mark as Completed' })
      .click();
    await expect(toast(page, 'Home visit marked as completed')).toBeVisible();
  });

  test('release results: abnormal needs a comment and review', async ({ page }) => {
    await logIn(page);
    await page.goto(`${PRACTICE}/test-results/`);
    const table = page.getByRole('table', { name: 'Results to release' });
    await table.getByRole('row', { name: /HbA1c/ }).getByRole('button', { name: 'Review and Release' }).click();
    const modal = page.getByRole('dialog', { name: /Release HbA1c/ });
    const submit = modal.getByRole('button', { name: 'Release to Patient' });
    await expect(modal).toContainText('never released automatically');
    await expect(submit).toBeDisabled();
    await modal.getByLabel(/Comment for the patient/).fill('Slightly high. Please book a review.');
    await expect(submit).toBeDisabled();
    await modal.getByRole('checkbox').check();
    await submit.click();
    await expect(toast(page, 'Released to the patient')).toBeVisible();
    await expect(table.getByRole('row', { name: /HbA1c/ })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Released' }).click();
    const released = page.getByRole('table', { name: 'Released results' });
    await expect(released).toContainText('HbA1c');
    await released.getByRole('row', { name: /HbA1c/ }).getByRole('link').click();
    await expect(page.getByRole('tab', { name: 'Test Results' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Comment for the patient: “Slightly high. Please book a review.”')).toBeVisible();
  });

  test('patient-added entries: self-reported, or reviewed when the practice turns review on', async ({ page }) => {
    await logIn(page);
    await page.goto(`${PRACTICE}/test-results/?tab=released`);
    await page.getByRole('table', { name: 'Released results' }).getByRole('link').first().click();
    await page.getByRole('tab', { name: 'Health' }).click();
    await expect(page.getByText('Self-reported by patient').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to Record' })).toHaveCount(0);
    const profile = page.url().split('#')[0];

    await page.goto(`${PRACTICE}/settings/appointment-configuration/`);
    await page.getByLabel('Clinicians review entries patients add').check();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(toast(page, /updated successfully/)).toBeVisible();

    await page.goto(`${profile}#health`);
    await expect(page.getByText(/^Awaiting Review \(\d\)$/)).toBeVisible();
    await page.getByRole('button', { name: 'Add to Record' }).first().click();
    await expect(toast(page, 'Added to the GP record')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Dismiss Entry' });
    await expect(dialog.getByRole('button', { name: 'Dismiss' })).toBeDisabled();
    await dialog.getByRole('textbox', { name: 'Reason' }).fill('Not confirmed by tests');
    await dialog.getByRole('button', { name: 'Dismiss' }).click();
    await expect(toast(page, 'Entry dismissed')).toBeVisible();
    await expect(page.getByText(/Dismissed: “Not confirmed by tests”/)).toBeVisible();
  });

  test('letter requests: start, fee, ready and decline', async ({ page }) => {
    await logIn(page);
    await page.goto(`${PRACTICE}/letter-requests/`);
    const table = page.getByRole('table', { name: 'Letter requests' });
    const fly = table.getByRole('row', { name: /Fit to travel/ });
    await fly.getByRole('button', { name: 'Start' }).click();
    await expect(toast(page, 'Letter request started')).toBeVisible();
    await fly.getByRole('button', { name: 'Fee' }).click();
    await page
      .getByRole('dialog', { name: 'Tell the Patient About a Fee' })
      .getByRole('button', { name: 'Send to Patient' })
      .click();
    await expect(toast(page, 'Fee sent to the patient')).toBeVisible();
    await expect(fly).toContainText('Fee to Confirm');

    await fly.getByRole('button', { name: 'Mark Ready' }).click();
    const ready = page.getByRole('dialog', { name: 'Mark Letter Ready' });
    await expect(ready.getByRole('button', { name: 'Mark Ready' })).toBeDisabled();
    await ready.getByLabel('Letter PDF').setInputFiles({
      name: 'Fit_to_fly.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 demo'),
    });
    await ready.getByRole('button', { name: 'Mark Ready' }).click();
    await expect(toast(page, 'Letter marked as ready')).toBeVisible();
    await expect(fly).toContainText('Fit_to_fly.pdf');

    const school = table.getByRole('row', { name: /School or college/ });
    await school.getByRole('button', { name: 'Decline' }).click();
    const decline = page.getByRole('dialog', { name: 'Decline Request' });
    await decline.getByRole('textbox', { name: 'Reason' }).fill('Please ask the hospital for this letter.');
    await decline.getByRole('button', { name: 'Decline Request' }).click();
    await expect(toast(page, 'Letter request declined')).toBeVisible();
    await expect(school).toContainText('Declined');
  });
});
