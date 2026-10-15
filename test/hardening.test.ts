import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { BlobStorage } from '../src/blobs.ts';
import { ApiError } from '../src/core.ts';
import { fixture, relative, upload } from './helpers.ts';

await test('an in-flight known-size upload keeps its quota reservation after expiry', async (t) => {
	const f = await fixture({ maxUserBytes: 20 }); t.after(() => f.cleanup());
	const entered = Promise.withResolvers<void>(); const release = Promise.withResolvers<void>();
	f.ctx.blobs.setValidator('blocked-test', async () => { entered.resolve(); await release.promise; });
	const blob = f.ctx.blobs.create(f.user.id, { kind: 'blocked-test', resourceId: 'test', expectedSize: 10 });
	const uploading = f.app.inject({ method: 'PUT', url: relative(blob.url), headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(10) });
	await entered.promise;
	f.ctx.db.run('UPDATE blobs SET expires=1 WHERE id=?', blob.id);
	try {
		assert.throws(() => f.ctx.blobs.create(f.user.id, { kind: 'test', resourceId: 'second', expectedSize: 15 }), /quota/i);
	} finally { release.resolve(); await uploading; }
});

await test('cancellation immediately before publication cannot resurrect an uploaded blob', async (t) => {
	const f = await fixture(); t.after(() => f.cleanup());
	const blob = f.ctx.blobs.create(f.user.id, { kind: 'test', resourceId: 'cancel' });
	const run = f.ctx.db.run.bind(f.ctx.db); let cancelled = false;
	t.mock.method(f.ctx.db, 'run', (sql: string, ...values: SQLInputValue[]) => {
		if (!cancelled && sql.includes("SET state='uploaded'")) {
			cancelled = true;
			run("UPDATE blobs SET state='failed',size=0 WHERE id=?", blob.id);
		}
		return run(sql, ...values);
	});
	const response = await f.app.inject({ method: 'PUT', url: relative(blob.url), headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('cancel during rename') });
	assert.equal(response.statusCode, 409);
	assert.equal(f.ctx.blobs.get(blob.id)?.state, 'failed');
	assert.equal(f.ctx.blobs.ready(blob.id), undefined);
	await assert.rejects(stat(f.ctx.blobs.get(blob.id)!.path), { code: 'ENOENT' });
});

await test('immutable upload replay is rejected as soon as it exceeds the confirmed size', async (t) => {
	const f = await fixture({ maxUploadBytes: 128, maxUserBytes: 64 }); t.after(() => f.cleanup());
	const blob = f.ctx.blobs.create(f.user.id, { kind: 'test', resourceId: 'replay', expectedSize: 1 });
	await upload(f.app, blob, Buffer.from('x'));
	const stream = new PassThrough();
	const response = f.app.inject({ method: 'PUT', url: relative(blob.url), headers: { 'content-type': 'application/octet-stream' }, payload: stream })
		.then(result => ({ statusCode: result.statusCode }), (error: unknown) => {
			if (!(error instanceof ApiError)) throw error;
			return { statusCode: error.statusCode };
		});
	stream.write(Buffer.from('xx'));
	const deadline = Promise.withResolvers<undefined>(); const timer = setTimeout(() => deadline.resolve(undefined), 1000);
	const early = await Promise.race([response, deadline.promise]); clearTimeout(timer); stream.end();
	const result = await response;
	assert.ok(early, 'Oversized immutable replays must fail before the sender closes the stream.');
	assert.equal(result.statusCode, 409);
	assert.equal((await f.app.inject(relative(f.ctx.blobs.downloadUrl(blob.id)))).body, 'x');
});

await test('startup clears abandoned upload part files without removing unrelated files', async (t) => {
	const f = await fixture(); t.after(() => f.cleanup());
	const directory = join(f.ctx.config.dataDir, 'blobs');
	const part = join(directory, `${randomUUID()}.${randomUUID()}.part`); const unrelated = join(directory, 'keep-me');
	await writeFile(part, 'interrupted bytes'); await writeFile(unrelated, 'kept');
	const restarted = new BlobStorage(f.ctx.db, f.ctx.config); await restarted.initialize();
	await assert.rejects(stat(part), { code: 'ENOENT' });
	assert.equal((await stat(unrelated)).size, 4);
});
