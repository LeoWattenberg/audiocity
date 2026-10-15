import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UploadDescriptor } from '../src/core.ts';
import { createUser, fixture, upload } from './helpers.ts';

interface Audio { id: string; title: string; play: { url: string } }
interface AudioPolicy extends UploadDescriptor { audio: Audio }
interface SearchResult { type: string; model: Audio }
const headers = (token: string) => ({ authorization: `Bearer ${token}` });

async function recording(f: Awaited<ReturnType<typeof fixture>>, token: string, metadata: Record<string, unknown>, ready = true) {
	const bytes = Buffer.from('fLaCfixture');
	const result = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers: headers(token), payload: {
		mime: 'audio/flac', size: bytes.length, name: 'Recording.flac', ...metadata,
	} });
	assert.equal(result.statusCode, 201, result.body);
	const policy = result.json<AudioPolicy>();
	if (ready) await upload(f.app, policy, bytes, 'audio/flac');
	return policy.audio;
}

void test('v1 search discovers ready public recordings across accounts without exposing private, unlisted or pending uploads', async () => {
	const f = await fixture();
	try {
		const other = await createUser(f.app, f.token);
		const own = await recording(f, f.token, { title: 'Own listed rain', is_listed: true });
		const shared = await recording(f, other.token, { title: 'Other listed rain', visibility: 'public' });
		await recording(f, f.token, { title: 'Private rain' });
		await recording(f, other.token, { title: 'Unlisted rain', is_listed: false });
		await recording(f, f.token, { title: 'Pending rain', is_listed: true }, false);
		const result = await f.app.inject({ url: '/v1/search?types=audio&query=RAIN&page=1', headers: headers(f.token) });
		assert.equal(result.statusCode, 200, result.body);
		const hits = result.json<SearchResult[]>();
		assert.deepEqual(hits.map(hit => [hit.type, hit.model.id]), [['audio', shared.id], ['audio', own.id]]);
		assert.ok(hits.every(hit => hit.model.play.url.startsWith(`${f.ctx.config.publicUrl}/media/`)));
	} finally { await f.cleanup(); }
});

void test('v1 search matches descriptions, author names and tags, with exact hashtag and literal wildcard searches', async () => {
	const f = await fixture();
	try {
		const other = await createUser(f.app, f.token);
		const tagged = await recording(f, f.token, { title: 'Quiet room', description: 'Forest birds', tags: ['rain', '100%_\\'], is_listed: true });
		const rainstorm = await recording(f, f.token, { title: 'Thunder', tags: ['rainstorm'], is_listed: true });
		const authored = await recording(f, other.token, { title: 'Another recording', is_listed: true });
		for (const [query, expected] of [
			['forest', [tagged.id]], ['rain', [rainstorm.id, tagged.id]], ['#RAIN', [tagged.id]],
			['100%_\\', [tagged.id]], ['other user', [authored.id]], ['#rai', []],
		] as const) {
			const result = await f.app.inject({ url: `/v1/search?types=audio&query=${encodeURIComponent(query)}`, headers: headers(f.token) });
			assert.equal(result.statusCode, 200, result.body);
			assert.deepEqual(result.json<SearchResult[]>().map(hit => hit.model.id), expected, query);
		}
	} finally { await f.cleanup(); }
});

void test('v1 search uses fixed ten-result pages and includes audio only for requested types', async () => {
	const f = await fixture();
	try {
		const ids: string[] = [];
		for (let index = 0; index < 12; index++) ids.push((await recording(f, f.token, { title: `Recording ${index}`, is_listed: true })).id);
		for (const [query, expected] of [
			['', ids.slice(2).reverse()], ['?page=2&types=audio,collection', ids.slice(0, 2).reverse()],
			['?page=3', []], ['?types=author,collection', []],
		] as const) {
			const result = await f.app.inject({ url: `/v1/search${query}`, headers: headers(f.token) });
			assert.equal(result.statusCode, 200, result.body);
			assert.deepEqual(result.json<SearchResult[]>().map(hit => hit.model.id), expected);
		}
	} finally { await f.cleanup(); }
});

void test('v1 search requires audio scope and validates search parameters', async () => {
	const f = await fixture();
	try {
		assert.equal((await f.app.inject('/v1/search')).statusCode, 401);
		const login = await f.app.inject({ method: 'POST', url: '/auth/token', payload: {
			grant_type: 'password', username: 'admin@example.test', password: 'test-password-for-admin', scope: 'projects',
		} });
		const token = login.json<{ access_token: string }>().access_token;
		assert.equal((await f.app.inject({ url: '/v1/search', headers: headers(token) })).statusCode, 403);
		const publicLogin = await f.app.inject({ method: 'POST', url: '/auth/token', payload: {
			grant_type: 'password', username: 'admin@example.test', password: 'test-password-for-admin', scope: 'public',
		} });
		const publicToken = publicLogin.json<{ access_token: string }>().access_token;
		assert.equal((await f.app.inject({ url: '/v1/search', headers: headers(publicToken) })).statusCode, 200);
		for (const query of ['page=0', 'page=1.5', 'page=1000000', 'types=project', 'types=audio&types=author', 'query=a&query=b', `query=${'a'.repeat(257)}`]) {
			const result = await f.app.inject({ url: `/v1/search?${query}`, headers: headers(f.token) });
			assert.equal(result.statusCode, 422, `${query}: ${result.body}`);
		}
	} finally { await f.cleanup(); }
});

void test('v1 search rate limits each authenticated account independently', async () => {
	const f = await fixture();
	try {
		const other = await createUser(f.app, f.token);
		for (let index = 0; index < 60; index++) {
			const result = await f.app.inject({ url: '/v1/search?types=audio', headers: headers(f.token) });
			assert.equal(result.statusCode, 200, result.body);
		}
		const limited = await f.app.inject({ url: '/v1/search?types=audio', headers: headers(f.token) });
		assert.equal(limited.statusCode, 429, limited.body);
		assert.ok(limited.headers['retry-after']);
		const independent = await f.app.inject({ url: '/v1/search?types=audio', headers: headers(other.token) });
		assert.equal(independent.statusCode, 200, independent.body);
	} finally { await f.cleanup(); }
});
