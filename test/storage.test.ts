import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import { Database } from '../src/database.ts';
import { readConfig } from '../src/config.ts';
import { BlobStorage, registerBlobRoutes } from '../src/blobs.ts';
import { ApiError } from '../src/core.ts';

async function storage(maxUserBytes = 32) {
	const dir = await mkdtemp(join(tmpdir(), 'audiocity-blobs-'));
	const config = { ...readConfig({ NODE_ENV: 'test' }), dataDir: dir, maxUploadBytes: 16, maxUserBytes };
	const db = new Database(join(dir, 'test.sqlite'));
	const blobs = new BlobStorage(db, config);
	await blobs.initialize();
	const app = Fastify();
	app.setErrorHandler((error: Error, _request, reply) => {
		void reply.code(error instanceof ApiError ? error.statusCode : 500).send({ message: error.message });
	});
	await registerBlobRoutes(app, blobs);
	await app.ready();
	return { app, blobs, db, config, async cleanup() { await app.close(); db.close(); await rm(dir, { recursive: true, force: true }); } };
}

function relative(url: string): string { const u = new URL(url); return u.pathname + u.search; }

void test('capability upload, explicit completion, immutable bytes and range downloads', async t => {
	const f = await storage(); t.after(() => f.cleanup());
	const d = f.blobs.create('alice', { kind: 'test', resourceId: '1', expectedSize: 6 });
	assert.equal((await f.app.inject({ method: 'PUT', url: relative(d.url).replace(/token=.*/, 'token=wrong'), payload: 'abcdef' })).statusCode, 403);
	assert.equal((await f.app.inject({ method: 'POST', url: relative(d.success) })).statusCode, 409);
	assert.equal((await f.app.inject({ method: 'PUT', url: relative(d.url), headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('abcdef') })).statusCode, 200);
	assert.equal(f.blobs.ready(d.id), undefined);
	assert.equal((await f.app.inject({ method: 'POST', url: relative(d.success) })).statusCode, 200);
	assert.equal((await f.app.inject({ method: 'POST', url: relative(d.success) })).statusCode, 200);
	const media = relative(f.blobs.downloadUrl(d.id));
	assert.equal((await f.app.inject(media)).body, 'abcdef');
	const partial = await f.app.inject({ url: media, headers: { range: 'bytes=1-3' } });
	assert.equal(partial.statusCode, 206); assert.equal(partial.body, 'bcd');
	assert.equal(partial.headers['content-range'], 'bytes 1-3/6');
	assert.equal((await f.app.inject({ url: media, headers: { range: 'bytes=8-' } })).statusCode, 416);
	assert.equal((await f.app.inject(media.replace(/signature=.*/, 'signature=bad'))).statusCode, 403);
	assert.equal((await f.app.inject({ method: 'PUT', url: relative(d.url), headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('xxxxxx') })).statusCode, 409);
});

void test('size, quota and format failures never publish a blob', async t => {
	const f = await storage(10); t.after(() => f.cleanup());
	const first = f.blobs.create('alice', { kind: 'test', resourceId: '1', expectedSize: 6 });
	assert.throws(() => f.blobs.create('alice', { kind: 'test', resourceId: '2', expectedSize: 6 }), /quota/i);
	const bad = await f.app.inject({ method: 'PUT', url: relative(first.url), headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('abc') });
	assert.equal(bad.statusCode, 422); assert.equal(f.blobs.ready(first.id), undefined);
	const invalid = f.blobs.create('bob', { kind: 'test', resourceId: '3', validate() { throw new ApiError(422, 'Invalid format'); } });
	assert.equal((await f.app.inject({ method: 'PUT', url: relative(invalid.url), headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('abc') })).statusCode, 422);
	assert.equal(f.blobs.ready(invalid.id), undefined);
	assert.equal((await f.app.inject({ method: 'POST', url: relative(invalid.fail) })).statusCode, 200);
});

void test('download signatures and persisted blobs survive a server restart', async t => {
	const f = await storage(); t.after(() => f.cleanup());
	const d = f.blobs.create('alice', { kind: 'test', resourceId: '1' });
	await f.app.inject({ method: 'PUT', url: relative(d.url), headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('persistent') });
	await f.app.inject({ method: 'GET', url: relative(d.success) });
	const second = new BlobStorage(f.db, f.config); await second.initialize();
	assert.equal(second.ready(d.id)?.size, 10);
	assert.equal((await f.app.inject(relative(second.downloadUrl(d.id)))).body, 'persistent');
});
