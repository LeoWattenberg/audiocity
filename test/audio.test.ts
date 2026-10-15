import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUser, fixture, upload } from './helpers.ts';
import type { UploadDescriptor } from '../src/core.ts';

interface Audio {
	id: string;
	slug: string;
	title: string;
	status: string;
	play: { url: string };
	visibility: string;
}
interface AudioPolicy extends UploadDescriptor { audio: Audio; progress: string; extra: { audio: Audio } }
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
function wav(): Buffer {
	const result = Buffer.alloc(48);
	result.write('RIFF');
	result.writeUInt32LE(40, 4);
	result.write('WAVEfmt ', 8);
	result.writeUInt32LE(16, 16);
	result.writeUInt16LE(1, 20);
	result.writeUInt16LE(1, 22);
	result.writeUInt32LE(8000, 24);
	result.writeUInt32LE(16000, 28);
	result.writeUInt16LE(2, 32);
	result.writeUInt16LE(16, 34);
	result.write('data', 36);
	result.writeUInt32LE(4, 40);
	return result;
}

void test('audio upload is private until explicitly shared, stays pending until confirmed, and downloads original bytes', async () => {
	const f = await fixture();
	try {
		const bytes = wav();
		const create = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers: headers(f.token), payload: { mime: 'audio/wav', size: bytes.length, name: 'Recorded rain.wav', category: 'recording', visibility: 'private' } });
		assert.equal(create.statusCode, 201, create.body);
		const policy = create.json<AudioPolicy>();
		assert.equal(policy.audio.title, 'Recorded rain');
		assert.equal(policy.audio.status, 'pending');
		assert.equal(policy.audio.play.url, '');
		assert.equal((await f.app.inject(`/public/audio/${policy.audio.id}`)).statusCode, 404);
		await upload(f.app, policy, bytes, 'audio/wav');
		const view = await f.app.inject({ url: `/v1/audio/view?id=${policy.audio.id}`, headers: headers(f.token) });
		assert.equal(view.json<Audio>().status, 'ready');
		const stream = await f.app.inject(new URL(view.json<Audio>().play.url).pathname + new URL(view.json<Audio>().play.url).search);
		assert.deepEqual(stream.rawPayload, bytes);
		const download = await f.app.inject({ url: `/download/${policy.audio.id}`, headers: headers(f.token) });
		assert.equal(download.json<{ items: { source: boolean; format: string }[] }>().items[0]?.source, true);
		assert.equal(download.json<{ items: { format: string }[] }>().items[0]?.format, 'wav');
	} finally { await f.cleanup(); }
});

void test('audio ownership holds across view, edit, delete, listing, and source download', async () => {
	const f = await fixture();
	try {
		const other = await createUser(f.app, f.token);
		const create = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers: headers(f.token), payload: { mime: 'audio/wav', size: 48, category: 'other', visibility: 'private' } });
		const policy = create.json<AudioPolicy>();
		await upload(f.app, policy, wav(), 'audio/wav');
		for (const [method, url, payload] of [
			['GET', `/v1/audio/view?id=${policy.audio.id}`, undefined],
			['GET', `/audio/${policy.audio.id}`, undefined],
			['GET', `/download/${policy.audio.id}`, undefined],
			['PATCH', `/v1/audio/update?id=${policy.audio.id}`, { title: 'stolen' }],
			['POST', `/v1/audio/delete?id=${policy.audio.id}`, undefined],
		] as const) {
			const response = await f.app.inject({ method, url, headers: headers(other.token), ...(payload ? { payload } : {}) });
			assert.equal(response.statusCode, 404, `${method} ${url}: ${response.body}`);
		}
		const list = await f.app.inject({ url: '/v1/audio/list', headers: headers(other.token) });
		assert.deepEqual(list.json(), []);
	} finally { await f.cleanup(); }
});

void test('Audacity upload policy and pagination include its required DTO fields', async () => {
	const f = await fixture();
	try {
		const result = await f.app.inject({ method: 'POST', url: '/audio', headers: headers(f.token), payload: { mime: 'audio/x-wav', size: 48, name: 'Audacity song', public: false, method: 'PUT' } });
		assert.equal(result.statusCode, 201, result.body);
		const policy = result.json<AudioPolicy>();
		assert.equal(policy.extra.audio.id, policy.audio.id);
		assert.ok(policy.progress);
		await upload(f.app, policy, wav());
		const resultList = await f.app.inject({ url: '/my/audio?page=1&per-page=10', headers: headers(f.token) });
		const list = resultList.json<{ items: { author: string; created: number; source: { size: number } }[]; pagination: { total: number; pages: number; page: number; size: number } }>();
		assert.equal(list.items.length, 1);
		assert.equal(typeof list.items[0]?.author, 'string');
		assert.equal(typeof list.items[0]?.created, 'number');
		assert.equal(list.items[0]?.source.size, 48);
		assert.deepEqual(list.pagination, { total: 1, pages: 1, page: 1, size: 10 });
	} finally { await f.cleanup(); }
});

void test('public sharing requires ready state and explicit visibility; downloads honor is_downloadable', async () => {
	const f = await fixture();
	try {
		const result = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers: headers(f.token), payload: { mime: 'audio/wav', size: 48, category: 'recording', is_listed: true } });
		const policy = result.json<AudioPolicy>();
		assert.equal((await f.app.inject(`/public/audio/${policy.audio.id}`)).statusCode, 404);
		await upload(f.app, policy, wav(), 'audio/wav');
		assert.equal((await f.app.inject(`/public/audio/${policy.audio.id}`)).statusCode, 200);
		assert.equal((await f.app.inject(`/download/${policy.audio.id}`)).statusCode, 404);
		const update = await f.app.inject({ method: 'PATCH', url: `/v1/audio/update?id=slug:${policy.audio.slug}`, headers: headers(f.token), payload: { is_listed: false, is_downloadable: true, title: 'Edited rain' } });
		assert.equal(update.statusCode, 200, update.body);
		assert.equal(update.json<Audio>().visibility, 'unlisted');
		assert.equal((await f.app.inject('/public/audio')).json<{ items: Audio[] }>().items.length, 0);
		assert.equal((await f.app.inject(`/download/${policy.audio.id}`)).statusCode, 200);
		assert.equal((await f.app.inject(`/public/audio/${policy.audio.id}`)).json<Audio>().title, 'Edited rain');
	} finally { await f.cleanup(); }
});

void test('uploads reject unsupported MIME, invalid metadata, size bounds, and disguised nonaudio bytes', async () => {
	const f = await fixture();
	try {
		for (const fields of [{ mime: 'text/html' }, { size: 0 }, { size: 1.5 }, { size: f.ctx.config.maxUploadBytes + 1 }, { title: '<script>x</script>', tags: [1] }, { visibility: 'everyone' }, { is_listed: 'yes' }, { category: 'not-a-category' }]) {
			const result = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers: headers(f.token), payload: { mime: 'audio/wav', size: 48, category: 'other', ...fields } });
			assert.equal(result.statusCode, 422, result.body);
		}
		const create = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers: headers(f.token), payload: { mime: 'audio/wav', size: 48, category: 'other', is_listed: true } });
		const policy = create.json<AudioPolicy>();
		const url = new URL(policy.url);
		const put = await f.app.inject({ method: 'PUT', url: url.pathname + url.search, headers: { 'content-type': 'audio/wav' }, payload: Buffer.alloc(48, 60) });
		assert.equal(put.statusCode, 422, put.body);
		assert.equal((await f.app.inject(`/public/audio/${policy.audio.id}`)).statusCode, 404);
	} finally { await f.cleanup(); }
});

void test('update slug uniqueness and delete remove metadata and revoke blob capabilities', async () => {
	const f = await fixture();
	try {
		const make = () => f.app.inject({ method: 'POST', url: '/v1/audio/create', headers: headers(f.token), payload: { mime: 'audio/wav', size: 48, category: 'other', name: 'Rain.wav' } });
		const first = (await make()).json<AudioPolicy>();
		const second = (await make()).json<AudioPolicy>();
		assert.notEqual(first.audio.slug, second.audio.slug);
		await upload(f.app, first, wav(), 'audio/wav');
		const view = await f.app.inject({ url: `/v1/audio/view?id=${first.audio.id}`, headers: headers(f.token) });
		const stream = new URL(view.json<Audio>().play.url);
		const duplicate = await f.app.inject({ method: 'PATCH', url: `/v1/audio/update?id=${second.audio.id}`, headers: headers(f.token), payload: { slug: first.audio.slug } });
		assert.equal(duplicate.statusCode, 409);
		assert.equal((await f.app.inject({ method: 'POST', url: `/v1/audio/delete?id=${first.audio.id}`, headers: headers(f.token) })).statusCode, 204);
		assert.equal((await f.app.inject(stream.pathname + stream.search)).statusCode, 404);
		assert.equal((await f.app.inject({ url: `/v1/audio/view?id=${first.audio.id}`, headers: headers(f.token) })).statusCode, 404);
	} finally { await f.cleanup(); }
});
