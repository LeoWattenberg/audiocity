import assert from 'node:assert/strict';
import test from 'node:test';
import type { UploadDescriptor } from '../src/core.ts';
import { authorizationHtml } from '../src/auth-ui.ts';
import { fixture, relative, upload } from './helpers.ts';

interface Created {
	project: { id: string };
	snapshot: { id: string };
	sync: { file: UploadDescriptor; blocks: UploadDescriptor[] };
}

await test('consent discloses all-scope permissions even when combined with public confinement', () => {
	assert.match(authorizationHtml('flow', 'Editor', 'all public'), /cloud projects, and any administration permitted/);
});

await test('native project creation and completion match the observed audio.com HTTP contract', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const headers = { authorization: `Bearer ${f.token}` };
	const hash = '00000001ABCDEF0123456789ABCDEF01';
	const create = await f.app.inject({ method: 'POST', url: '/project', headers,
		payload: { name: 'Native parity', blocks: [hash, hash.toLowerCase()] } });
	assert.equal(create.statusCode, 200, create.body);
	const created = create.json<Created>();
	assert.deepEqual(created.sync.blocks.map(block => block.id), [hash.toLowerCase()]);
	await upload(f.app, created.sync.file, Buffer.from('native serialized metadata'));
	await upload(f.app, created.sync.blocks[0]!, Buffer.from('native WavPack bytes'));
	const snapshotPath = `/project/${created.project.id}/snapshot/${created.snapshot.id}`;
	for (let index = 0; index < 2; index++) {
		const complete = await f.app.inject({ method: 'POST', url: `${snapshotPath}/sync`, headers });
		assert.equal(complete.statusCode, 204, complete.body);
		assert.equal(complete.body, '');
	}
	const read = await f.app.inject({ url: `${snapshotPath}?expand=blocks,file_url`, headers });
	const snapshot = read.json<{ date_synced: number; file_url: string; blocks: { hash: string; url: string }[] }>();
	assert.ok(snapshot.date_synced > 0);
	assert.equal(snapshot.blocks[0]?.hash, hash.toLowerCase());
	assert.equal((await f.app.inject(relative(snapshot.file_url))).body, 'native serialized metadata');
	assert.equal((await f.app.inject(relative(snapshot.blocks[0].url))).body, 'native WavPack bytes');
	const next = await f.app.inject({ method: 'POST', url: `/project/${created.project.id}/snapshot`, headers,
		payload: { head_snapshot_id: created.snapshot.id, blocks: [hash] } });
	assert.equal(next.statusCode, 200, next.body);
	assert.deepEqual(next.json<Created>().sync.blocks, []);
	assert.equal((await f.app.inject({ method: 'DELETE', url: `/project/${created.project.id}`, headers })).statusCode, 204);
});

await test('public all remains public-confined until refresh narrows to all, while archive scope stays explicit', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const login = async (scope: string) => f.app.inject({ method: 'POST', url: '/auth/token',
		payload: { grant_type: 'password', username: f.ctx.config.adminEmail, password: f.ctx.config.adminPassword, scope } });
	const first = (await login('public all')).json<{ access_token: string; refresh_token: string }>();
	const headers = { authorization: `Bearer ${first.access_token}` };
	const forbidden = await f.app.inject({ url: '/project', headers });
	assert.equal(forbidden.statusCode, 403);
	assert.match(forbidden.json<{ message: string }>().message, /limited to the public API/);
	assert.equal((await f.app.inject({ url: '/v1/audio/list', headers })).statusCode, 200);
	const refresh = await f.app.inject({ method: 'POST', url: '/auth/token',
		payload: { grant_type: 'refresh_token', refresh_token: first.refresh_token, scope: 'all' } });
	assert.equal(refresh.statusCode, 200, refresh.body);
	const narrowed = refresh.json<{ access_token: string }>();
	assert.equal((await f.app.inject({ url: '/project', headers: { authorization: `Bearer ${narrowed.access_token}` } })).statusCode, 200);
	const archive = (await login('public projects')).json<{ access_token: string }>();
	const created = await f.app.inject({ method: 'POST', url: '/project',
		headers: { authorization: `Bearer ${archive.access_token}` }, payload: { name: 'Local archive extension', format: 'aup3' } });
	assert.equal(created.statusCode, 201, created.body);
	const value = created.json<Created>();
	await upload(f.app, value.sync.file, Buffer.from('SQLite format 3\0archive'));
	const synced = await f.app.inject({ method: 'POST', url: `/project/${value.project.id}/snapshot/${value.snapshot.id}/sync`,
		headers: { authorization: `Bearer ${archive.access_token}` } });
	assert.equal(synced.statusCode, 200, synced.body);
	assert.ok(synced.json<{ file_url: string }>().file_url);
});

await test('regular audio creation requires category and defaults to audio.com unlisted sharing', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const headers = { authorization: `Bearer ${f.token}` };
	const missing = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers,
		payload: { name: 'Unlisted.wav', mime: 'audio/wav', size: 48 } });
	assert.equal(missing.statusCode, 422);
	const bytes = Buffer.alloc(48);
	bytes.write('RIFF'); bytes.writeUInt32LE(40, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24);
	bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36); bytes.writeUInt32LE(4, 40);
	const response = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers,
		payload: { name: 'Unlisted.wav', mime: 'audio/wav', size: bytes.length, category: 'recording' } });
	assert.equal(response.statusCode, 201, response.body);
	const policy = response.json<UploadDescriptor & { audio: { id: string; visibility: string; is_listed: boolean } }>();
	assert.equal(policy.audio.visibility, 'unlisted');
	assert.equal(policy.audio.is_listed, false);
	assert.equal((await f.app.inject(`/public/audio/${policy.audio.id}`)).statusCode, 404);
	await upload(f.app, policy, bytes, 'audio/wav');
	assert.equal((await f.app.inject(`/public/audio/${policy.audio.id}`)).statusCode, 200);
	assert.deepEqual((await f.app.inject({ url: '/v1/search?query=Unlisted&types=audio', headers })).json(), []);
});

await test('existing mixed-case native block records remain readable and reusable without rewriting stored bytes', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const headers = { authorization: `Bearer ${f.token}` };
	const response = await f.app.inject({ method: 'POST', url: '/project', headers,
		payload: { name: 'Before normalization', blocks: ['abcdef'] } });
	const original = response.json<Created>();
	await upload(f.app, original.sync.file, Buffer.from('original metadata'));
	await upload(f.app, original.sync.blocks[0]!, Buffer.from('original compressed audio'));
	f.ctx.db.run('UPDATE project_blocks SET hash=? WHERE owner_id=? AND hash=?', 'ABCDEF', f.user.id, 'abcdef');
	f.ctx.db.run('UPDATE snapshot_blocks SET hash=? WHERE owner_id=? AND hash=?', 'ABCDEF', f.user.id, 'abcdef');
	const copy = await f.app.inject({ method: 'POST', url: '/project', headers,
		payload: { name: 'Reuse normalized hash', blocks: ['AbCdEf'] } });
	assert.equal(copy.statusCode, 200, copy.body);
	assert.deepEqual(copy.json<Created>().sync.blocks, []);
	const read = await f.app.inject({ url: `/project/${original.project.id}/snapshot/${original.snapshot.id}?expand=blocks,file_url`, headers });
	const block = read.json<{ blocks: { hash: string; url: string }[] }>().blocks[0]!;
	assert.equal(block.hash, 'abcdef');
	assert.equal((await f.app.inject(relative(block.url))).body, 'original compressed audio');
});

await test('public audio list defaults to 50 items, with explicit page sizes retained', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const headers = { authorization: `Bearer ${f.token}` };
	for (let index = 0; index < 51; index++) {
		const response = await f.app.inject({ method: 'POST', url: '/v1/audio/create', headers,
			payload: { name: `Item ${index}.wav`, mime: 'audio/wav', size: 48, category: 'recording' } });
		assert.equal(response.statusCode, 201);
	}
	assert.equal((await f.app.inject({ url: '/v1/audio/list', headers })).json<unknown[]>().length, 50);
	assert.equal((await f.app.inject({ url: '/v1/audio/list?page=2', headers })).json<unknown[]>().length, 1);
	assert.equal((await f.app.inject({ url: '/v1/audio/list?per-page=3', headers })).json<unknown[]>().length, 3);
});

await test('OAuth access lifetimes remain provider-selected and support the observed one-year audio.com value', async t => {
	const f = await fixture({ tokenTtlSeconds: 31_536_000 }); t.after(() => f.cleanup());
	const response = await f.app.inject({ method: 'POST', url: '/auth/token', payload: {
		grant_type: 'password', username: f.ctx.config.adminEmail, password: f.ctx.config.adminPassword, scope: 'public',
	} });
	assert.equal(response.statusCode, 200);
	const tokens = response.json<{ token_type: string; expires_in: number; access_token: string; refresh_token: string }>();
	assert.equal(tokens.token_type.toLowerCase(), 'bearer');
	assert.equal(tokens.expires_in, 31_536_000);
	assert.ok(tokens.access_token && tokens.refresh_token);
});
