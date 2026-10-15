import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../src/app.ts';
import type { Config, UploadDescriptor, User } from '../src/core.ts';

export function relative(url: string): string { const value = new URL(url); return value.pathname + value.search; }

export async function fixture(overrides: Partial<Config> = {}) {
	const dir = await mkdtemp(join(tmpdir(), 'audiocity-test-'));
	const adminEmail = 'admin@example.test'; const password = 'test-password-for-admin';
	try {
		const { app, ctx } = await createApp({ dataDir: dir, logger: false, adminEmail, adminPassword: password, ...overrides });
		const login = await app.inject({ method: 'POST', url: '/auth/token', payload: { grant_type: 'password', username: adminEmail, password, client_id: ctx.config.audacityClientId, client_secret: ctx.config.audacityClientSecret, scope: 'all' } });
		assert.equal(login.statusCode, 200, login.body);
		const token = login.json<{ access_token: string }>().access_token;
		const who = await app.inject({ url: '/auth/me', headers: { authorization: `Bearer ${token}` } });
		const user = who.json<User>();
		return { app, ctx, token, user, async cleanup() { await app.close(); await rm(dir, { recursive: true, force: true }); } };
	} catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}

export async function createUser(app: FastifyInstance, token: string, email = `${randomUUID()}@example.test`) {
	const password = 'other-user-test-password';
	const created = await app.inject({ method: 'POST', url: '/admin/users', headers: { authorization: `Bearer ${token}` }, payload: { email, password, name: 'Other user' } });
	assert.equal(created.statusCode, 201, created.body);
	const login = await app.inject({ method: 'POST', url: '/auth/token', payload: { grant_type: 'password', username: email, password, scope: 'all' } });
	assert.equal(login.statusCode, 200, login.body);
	return { token: login.json<{ access_token: string }>().access_token, user: created.json<User>() };
}

export async function upload(app: FastifyInstance, descriptor: UploadDescriptor, bytes: Buffer, mime = 'application/octet-stream'): Promise<void> {
	const uploaded = await app.inject({ method: 'PUT', url: relative(descriptor.url), headers: { 'content-type': mime }, payload: bytes });
	assert.equal(uploaded.statusCode, 200, uploaded.body);
	const complete = await app.inject({ method: 'POST', url: relative(descriptor.success) });
	assert.equal(complete.statusCode, 200, complete.body);
}
