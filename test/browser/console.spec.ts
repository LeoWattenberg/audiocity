import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const initialPassword = 'browser-admin-password';
const changedPassword = 'changed-browser-password';

async function choose(page: Page, name: string): Promise<void> {
	await page.locator('#menu > summary').click();
	await page.getByRole('button', { name, exact: true }).click();
}
async function login(page: Page, password: string): Promise<void> {
	await page.getByLabel('Email or username').fill('browser@example.test');
	await page.getByLabel('Password', { exact: true }).fill(password);
	await page.getByRole('button', { name: 'Log in', exact: true }).last().click();
}
async function currentToken(page: Page): Promise<string | null> {
	return page.evaluate(() => sessionStorage.getItem('audiocity.access-token'));
}
function audioFixture(): Buffer {
	const wav = Buffer.alloc(48);
	wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
	wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
	return wav;
}

test('console manages uploads, sharing, accounts and session lifecycle', async ({ page, request }, testInfo) => {
	const pageErrors: string[] = [];
	page.on('pageerror', error => { pageErrors.push(error.message); });
	let firstToken: string | null = null;

	await test.step('login is opt in and rejected passwords leave no stored session', async () => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Welcome to Audiocity' })).toBeVisible();
		await expect(page.locator('form:visible')).toHaveCount(0);
		await choose(page, 'Log in');
		await login(page, 'wrong-password');
		await expect(page.getByRole('status')).toContainText('Invalid email or password');
		await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
		expect(await currentToken(page)).toBeNull();
		await login(page, initialPassword);
		await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
		firstToken = await currentToken(page);
		expect(firstToken).toBeTruthy();
		await page.goto('/another-user/projects/foreign-project?next=https://other.example');
		await expect(page).toHaveURL(/\/\?view=projects$/);
		await expect(page.getByRole('heading', { name: 'Project library', exact: true })).toBeVisible();
	});

	await test.step('audio originals upload, preview and share with literal untrusted titles', async () => {
		await choose(page, 'Upload audio');
		await page.getByLabel('Recording', { exact: true }).setInputFiles({ name: 'rain.wav', mimeType: 'audio/wav', buffer: audioFixture() });
		const maliciousTitle = '<img src=x onerror=alert(1)>';
		await page.getByLabel('Title (optional)').fill(maliciousTitle);
		await page.getByRole('button', { name: 'Upload audio', exact: true }).last().click();
		await expect(page.getByRole('heading', { name: 'Audio library', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: maliciousTitle, exact: true })).toBeVisible();
		await expect(page.locator('img')).toHaveCount(0);
		const card = page.locator('article').filter({ has: page.getByRole('heading', { name: maliciousTitle, exact: true }) });
		await expect(card).toContainText('ready · private');
		await card.locator('summary').click();
		await card.getByRole('button', { name: 'Preview', exact: true }).click();
		await expect(card.locator('audio')).toBeVisible();
		await card.locator('summary').click();
		await card.getByRole('button', { name: 'Edit sharing', exact: true }).click();
		await page.getByLabel('Visibility').selectOption('unlisted');
		await page.getByLabel('Allow other listeners to download').check();
		await page.getByRole('button', { name: 'Save sharing' }).click();
		await expect(page.getByRole('link', { name: 'Open shared metadata' })).toBeVisible();
		const sharedUrl = await page.getByRole('link', { name: 'Open shared metadata' }).getAttribute('href');
		expect(sharedUrl).toBeTruthy();
		const shared = await request.get(sharedUrl!);
		expect(shared.status()).toBe(200);
		const metadata = await shared.json() as { title: string; visibility: string; is_downloadable: boolean };
		expect(metadata).toMatchObject({ title: maliciousTitle, visibility: 'unlisted', is_downloadable: true });
		await page.goto('/another-user/audio/foreign-audio/edit');
		await expect(page).toHaveURL(/\/\?view=audio$/);
		await expect(page.getByRole('heading', { name: 'Audio library', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: maliciousTitle, exact: true })).toBeVisible();
	});

	await test.step('native project mixdowns play in the library and revision history', async () => {
		const headers = { authorization: `Bearer ${await currentToken(page)}` };
		const created = await request.post('/project', { headers, data: { name: 'Playable project', blocks: [] } });
		expect(created.status()).toBe(200);
		const project = await created.json() as { project: { id: string }; snapshot: { id: string }; sync: { file: { url: string; success: string }; mixdown: { url: string; success: string } } };
		for (const [descriptor, bytes] of [[project.sync.file, Buffer.from('serialized project')], [project.sync.mixdown, audioFixture()]] as const) {
			expect((await request.put(descriptor.url, { headers: { 'content-type': 'application/octet-stream' }, data: bytes })).status()).toBe(200);
			expect((await request.post(descriptor.success)).status()).toBe(200);
		}
		expect((await request.post(`/project/${project.project.id}/snapshot/${project.snapshot.id}/sync`, { headers })).status()).toBe(204);
		await choose(page, 'Project library');
		const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Playable project', exact: true }) });
		await card.locator('summary').click();
		await card.getByRole('button', { name: 'Preview audio', exact: true }).click();
		await expect(card.getByLabel('Audio preview for Playable project')).toBeVisible();
		await expect.poll(() => card.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1);
		await card.locator('audio').evaluate((audio: HTMLAudioElement) => audio.play());
		await card.locator('summary').click();
		await card.getByRole('button', { name: 'Revisions', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Revisions: Playable project' })).toBeVisible();
		const revision = page.locator('article').first();
		await revision.locator('summary').click();
		await revision.getByRole('button', { name: 'Preview audio', exact: true }).click();
		await expect.poll(() => revision.locator('audio').evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1);
	});

	await test.step('AUP3 archives upload and revision downloads preserve exact bytes', async () => {
		await choose(page, 'Upload AUP3/AUP4');
		const archivePath = testInfo.outputPath('Fixture.aup3');
		const db = new DatabaseSync(archivePath);
		try { db.exec("CREATE TABLE project (name TEXT); INSERT INTO project VALUES ('browser fixture')"); }
		finally { db.close(); }
		const archive = await readFile(archivePath);
		await page.getByLabel('Project file', { exact: true }).setInputFiles({ name: 'Fixture.aup3', mimeType: 'application/octet-stream', buffer: archive });
		await page.getByRole('button', { name: 'Upload project revision', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Project library', exact: true })).toBeVisible();
		const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Fixture', exact: true }) });
		await card.locator('summary').click();
		await card.getByRole('button', { name: 'Revisions', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Revisions: Fixture' })).toBeVisible();
		const revision = page.locator('article').first();
		await expect(revision).toContainText('synchronized');
		await revision.locator('summary').click();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			revision.getByRole('button', { name: 'Download archive', exact: true }).click(),
		]);
		const downloadedPath = await download.path();
		expect(downloadedPath).toBeTruthy();
		expect(await readFile(downloadedPath)).toEqual(archive);
	});

	await test.step('administrators create accounts and password changes revoke existing sessions', async () => {
		await choose(page, 'Create account');
		await page.getByLabel('Email', { exact: true }).fill('created@example.test');
		await page.getByLabel('Display name').fill('Created Browser User');
		await page.getByLabel('Initial password').fill('created-user-password');
		await page.getByRole('button', { name: 'Create account', exact: true }).last().click();
		await expect(page.getByRole('status')).toContainText('Account created for created@example.test');
		await choose(page, 'Change password');
		await page.getByLabel('Current password', { exact: true }).fill(initialPassword);
		await page.getByLabel('New password', { exact: true }).fill(changedPassword);
		await page.getByLabel('Confirm new password', { exact: true }).fill(changedPassword);
		await page.getByRole('button', { name: 'Change password', exact: true }).last().click();
		await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible();
		await expect(page.getByRole('status')).toContainText('Password changed');
		expect(await currentToken(page)).toBeNull();
		const revoked = await request.get('/auth/me', { headers: { authorization: `Bearer ${firstToken}` } });
		expect(revoked.status()).toBe(401);
	});

	await test.step('expired sessions prompt login and logout revokes the replacement session', async () => {
		await login(page, changedPassword);
		await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
		const revokeToken = await currentToken(page);
		const revoked = await request.post('/auth/logout', { headers: { authorization: `Bearer ${revokeToken}` } });
		expect(revoked.status()).toBe(204);
		await choose(page, 'Audio library');
		await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible();
		await expect(page.getByRole('status')).toContainText('Your session expired');
		expect(await currentToken(page)).toBeNull();
		await login(page, changedPassword);
		await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
		const logoutToken = await currentToken(page);
		await choose(page, 'Log out');
		await expect(page.getByRole('heading', { name: 'Signed out' })).toBeVisible();
		expect(await currentToken(page)).toBeNull();
		const loggedOut = await request.get('/auth/me', { headers: { authorization: `Bearer ${logoutToken}` } });
		expect(loggedOut.status()).toBe(401);
		await page.goto('/another-user/projects/foreign-project');
		await expect(page.getByRole('heading', { name: 'Log in', exact: true })).toBeVisible();
		await login(page, changedPassword);
		await expect(page.getByRole('heading', { name: 'Project library', exact: true })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Fixture', exact: true })).toBeVisible();
		await choose(page, 'Log out');
		await expect(page.getByRole('heading', { name: 'Signed out' })).toBeVisible();
	});
	expect(pageErrors).toEqual([]);
});
