import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

for (const flow of ['manual token', 'password']) {
	test(`Audacity 3 ${flow} sign-in loads /me and opens its browser account`, async ({ page, request, baseURL }) => {
		const client = { client_id: 'browser-audacity', client_secret: 'browser-desktop-secret' };
		let credentials: Record<string, string>;
		if (flow === 'manual token') {
			const redirect = `${baseURL!}/auth/callback`;
			await page.goto(`/auth/authorize?${new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect, scope: 'all' })}`);
			await page.getByLabel('Email', { exact: true }).fill('oauth-browser@example.test');
			await page.getByLabel('Password', { exact: true }).fill('oauth-browser-password');
			await page.getByRole('button', { name: 'Allow access', exact: true }).click();
			await expect(page.getByRole('heading', { name: 'Your Audacity linking token' })).toBeVisible();
			await expect(page.getByLabel('Token', { exact: true })).toHaveAttribute('readonly', '');
			const uri = new URL(await page.getByLabel('Token', { exact: true }).inputValue());
			expect(uri.protocol).toBe('audacity:');
			expect(uri.hostname).toBe('link');
			credentials = { grant_type: 'authorization_code', code: uri.searchParams.get('authorization_code')!, redirect_uri: redirect, scope: 'all' };
		} else {
			credentials = { grant_type: 'password', username: 'oauth-browser@example.test', password: 'oauth-browser-password', scope: 'all' };
		}
		const exchange = await request.post('/auth/token', { data: { ...client, ...credentials } });
		expect(exchange.status()).toBe(200);
		const tokens = await exchange.json() as { access_token: string; token_type: string };
		const me = await request.get('/me', { headers: { Authorization: `${tokens.token_type} ${tokens.access_token}` } });
		expect(me.status()).toBe(200);
		const user = await me.json() as { id: string; username: string; avatar: string; profile: { name: string } };
		expect(user.id).toBeTruthy();
		expect(user.username).toBeTruthy();
		expect(user.avatar).toBe('');
		expect(user.profile.name).toBe('oauth-browser');
		const wav = Buffer.alloc(48);
		wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
		const headers = { authorization: `Bearer ${tokens.access_token}` };
		const created = await request.post('/audio', { headers, data: { name: `Audacity ${flow}.wav`, mime: 'audio/wav', size: wav.length, category: 'recording', visibility: 'private' } });
		expect(created.status()).toBe(201);
		const policy = await created.json() as { url: string; success: string; audio: { id: string; slug: string; title: string } };
		expect((await request.put(policy.url, { headers: { 'content-type': 'application/octet-stream' }, data: wav })).status()).toBe(200);
		expect((await request.post(policy.success)).status()).toBe(200);
		const destination = `/${user.username}/audio/${policy.audio.slug}/edit?mtm_campaign=Audacity&mtm_source=Audacity-3.7.9&mtm_content=Share_Audio_Menu`;
		const handoff = await page.goto(`/auth/check-and-redirect?${new URLSearchParams({ token: tokens.access_token, user: user.id, url: destination })}`);
		expect(handoff?.status()).toBe(200);
		await expect(page).toHaveURL(`${baseURL!}/audio/${policy.audio.id}/edit`);
		await expect(page.getByRole('heading', { name: `Edit: ${policy.audio.title}`, exact: true })).toBeVisible();
		await expect(page.getByText('Signed in as oauth-browser (oauth-browser@example.test)', { exact: true })).toBeVisible();
		expect(await page.evaluate(() => sessionStorage.getItem('audiocity.access-token'))).toBe(tokens.access_token);
		const logout = await request.post('/auth/logout', { headers: { Authorization: `${tokens.token_type} ${tokens.access_token}` } });
		expect(logout.status()).toBe(204);
	});
}

test('Audacity saved project browser links open the project library with or without a cached username', async ({ page, request, baseURL }) => {
	const login = await request.post('/auth/token', { data: {
		grant_type: 'password', username: 'oauth-browser@example.test', password: 'oauth-browser-password', scope: 'all',
		client_id: 'browser-audacity', client_secret: 'browser-desktop-secret'
	} });
	expect(login.status()).toBe(200);
	const { access_token: token } = await login.json() as { access_token: string };
	const headers = { Authorization: `Bearer ${token}` };
	let id: string | undefined;
	try {
		const created = await request.post('/project', { headers, data: { name: 'Project browser handoff', blocks: [] } });
		expect(created.status()).toBe(200);
		const result = await created.json() as { project: { id: string; username: string }; snapshot: { id: string }; sync: { file: { url: string; success: string } } };
		id = result.project.id;
		const upload = await request.put(result.sync.file.url, { headers: { 'Content-Type': 'application/octet-stream' }, data: Buffer.from('opaque native project metadata fixture') });
		expect(upload.status()).toBe(200);
		expect((await request.post(result.sync.file.success)).status()).toBe(200);
		expect((await request.post(`/project/${id}/snapshot/${result.snapshot.id}/sync`, { headers })).status()).toBe(204);
		const profile = await request.get('/me', { headers });
		expect(profile.status()).toBe(200);
		const user = await profile.json() as { id: string; username: string };
		expect(result.project.username).toBe(user.username);
		const tracking = '?mtm_campaign=Audacity&mtm_source=Audacity-3.7.9&mtm_content=Save_to_Cloud_Menu';
		for (const path of [`/${user.username}/projects/${id}`, `//projects/${id}`, '//projects']) {
			const handoff = await page.goto(`/auth/check-and-redirect?${new URLSearchParams({ token, user: user.id, url: path + tracking })}`);
			expect(handoff?.status()).toBe(200);
			await expect(page).toHaveURL(`${baseURL!}/?view=projects`);
			await expect(page.getByRole('heading', { name: 'Library', exact: true })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'Project browser handoff', exact: true })).toBeVisible();
			expect(await page.evaluate(() => sessionStorage.getItem('audiocity.access-token'))).toBe(token);
		}
	} finally {
		if (id) expect((await request.delete(`/project/${id}`, { headers })).status()).toBe(204);
		expect((await request.post('/auth/logout', { headers })).status()).toBe(204);
	}
});

test('PKCE authorization permits only its registered cross-origin callback after retry or cancellation', async ({ page, request }) => {
	const received: URL[] = [];
	const callback = createServer((incoming, response) => {
		const destination = new URL(incoming.url ?? '/', 'http://callback.test');
		if (destination.pathname === '/oauth/callback') received.push(destination);
		response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
		response.end('<!doctype html><title>Editor callback</title><h1>Editor callback received</h1>');
	});
	await new Promise<void>((resolve, reject) => {
		callback.once('error', reject);
		callback.listen(0, '127.0.0.1', resolve);
	});
	try {
		const address = callback.address();
		if (!address || typeof address === 'string') throw new Error('Callback server has no TCP address.');
		const redirect = `http://127.0.0.1:${address.port}/oauth/callback?panel=audio`;
		const registered = await request.post('/auth/client', { data: { client_name: 'Browser editor', redirect_uris: [redirect], token_endpoint_auth_method: 'none' } });
		expect(registered.status()).toBe(201);
		const client = await registered.json() as { client_id: string };
		const verifier = 'a'.repeat(64);
		const query = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: redirect,
			scope: 'public projects', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), state: 'browser-state' });
		const errors: string[] = [];
		page.on('console', message => { if (message.type() === 'error' && /form-action|Content Security Policy/u.test(message.text())) errors.push(message.text()); });
		await page.goto(`/auth/authorize?${query}`);
		await page.getByLabel('Email', { exact: true }).fill('oauth-browser@example.test');
		await page.getByLabel('Password', { exact: true }).fill('wrong-password');
		await page.getByRole('button', { name: 'Allow access', exact: true }).click();
		await expect(page.getByRole('alert')).toContainText('Invalid email or password');
		await page.getByLabel('Email', { exact: true }).fill('oauth-browser@example.test');
		await page.getByLabel('Password', { exact: true }).fill('oauth-browser-password');
		await Promise.all([
			page.waitForURL(url => url.origin === new URL(redirect).origin && url.pathname === '/oauth/callback', { timeout: 5000 }),
			page.getByRole('button', { name: 'Allow access', exact: true }).click(),
		]);
		await expect(page.getByRole('heading', { name: 'Editor callback received' })).toBeVisible();
		const result = new URL(page.url());
		expect(result.searchParams.get('state')).toBe('browser-state');
		expect(result.searchParams.get('panel')).toBe('audio');
		expect(result.searchParams.get('code')).toBeTruthy();
		const exchange = await request.post('/auth/token', { form: { grant_type: 'authorization_code', code: result.searchParams.get('code') ?? '', code_verifier: verifier, client_id: client.client_id, redirect_uri: redirect } });
		expect(exchange.status()).toBe(200);
		const tokens = await exchange.json() as { scope: string; token_type: string };
		expect(tokens.token_type).toBe('Bearer');
		expect(tokens.scope.split(' ').sort()).toEqual(['projects', 'public']);
		await page.goto(`/auth/authorize?${query}`);
		await page.getByLabel('Email', { exact: true }).fill('oauth-browser@example.test');
		await page.getByLabel('Password', { exact: true }).fill('oauth-browser-password');
		await Promise.all([
			page.waitForURL(url => url.origin === new URL(redirect).origin && url.searchParams.has('code'), { timeout: 5000 }),
			page.getByRole('button', { name: 'Allow access', exact: true }).click(),
		]);
		await page.goto(`/auth/authorize?${query}`);
		await Promise.all([
			page.waitForURL(url => url.origin === new URL(redirect).origin && url.searchParams.get('error') === 'access_denied', { timeout: 5000 }),
			page.getByRole('button', { name: 'Cancel', exact: true }).click(),
		]);
		expect(received).toHaveLength(3);
		expect(received[2]?.searchParams.get('state')).toBe('browser-state');
		expect(errors).toEqual([]);
	} finally {
		await new Promise<void>((resolve, reject) => { callback.close(error => { if (error) reject(error); else resolve(); }); });
	}
});
