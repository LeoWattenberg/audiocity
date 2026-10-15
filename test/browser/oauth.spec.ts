import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { expect, test } from '@playwright/test';

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
