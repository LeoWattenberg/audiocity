import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { createApp } from '../src/app.ts';
import type { UploadDescriptor } from '../src/core.ts';
import { createUser, fixture, relative, upload } from './helpers.ts';

interface Preview { url: string; mime: string; size: number; snapshot_id: string; is_current?: boolean }
interface Revision { id: string; preview: Preview | null }
interface Project { id: string; preview: Preview | null }
interface Created { project: Project; snapshot: Revision; sync: { file: UploadDescriptor; mixdown: UploadDescriptor } }
const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]);
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function create(f: Awaited<ReturnType<typeof fixture>>, previous?: Created): Promise<Created> {
	const response = await f.app.inject({ method: 'POST', url: previous ? `/project/${previous.project.id}/snapshot` : '/project', headers: auth(f.token),
		payload: { blocks: [], ...(previous ? { head_snapshot_id: previous.snapshot.id } : { name: 'Preview project' }) } });
	assert.equal(response.statusCode, 200, response.body);
	return response.json<Created>();
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, created: Created): Promise<void> {
	await upload(f.app, created.sync.file, Buffer.from('serialized project'));
	const response = await f.app.inject({ method: 'POST', url: `/project/${created.project.id}/snapshot/${created.snapshot.id}/sync`, headers: auth(f.token) });
	assert.equal(response.statusCode, 204, response.body);
}
async function project(f: Awaited<ReturnType<typeof fixture>>, created: Created): Promise<Project> {
	return (await f.app.inject({ url: `/project/${created.project.id}`, headers: auth(f.token) })).json<Project>();
}

await test('project previews detect MP3, support seeking, and retain revision-specific audio', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const first = await create(f);
	assert.equal((await project(f, first)).preview, null);
	await upload(f.app, first.sync.mixdown, mp3);
	assert.equal((await project(f, first)).preview, null, 'incomplete revisions are not advertised');
	await complete(f, first);
	const preview = (await project(f, first)).preview!;
	assert.equal(preview.mime, 'audio/mpeg');
	assert.equal(preview.size, mp3.length);
	assert.equal(preview.snapshot_id, first.snapshot.id);
	assert.equal(preview.is_current, true);
	const audio = await f.app.inject(relative(preview.url));
	assert.equal(audio.headers['content-type'], 'audio/mpeg');
	assert.deepEqual(audio.rawPayload, mp3);
	const range = await f.app.inject({ url: relative(preview.url), headers: { range: 'bytes=2-4' } });
	assert.equal(range.statusCode, 206);
	assert.equal(range.headers['content-range'], `bytes 2-4/${mp3.length}`);
	assert.deepEqual(range.rawPayload, mp3.subarray(2, 5));
	assert.equal((await f.app.inject(relative(preview.url).replace(/signature=[^&]+/, 'signature=wrong'))).statusCode, 403);
	assert.equal((await f.app.inject(`/project/${first.project.id}`)).statusCode, 401);
	const other = await createUser(f.app, f.token);
	assert.equal((await f.app.inject({ url: `/project/${first.project.id}`, headers: auth(other.token) })).statusCode, 404);
	assert.equal((await f.app.inject({ url: `/project/${first.project.id}/snapshot/${first.snapshot.id}`, headers: auth(other.token) })).statusCode, 404);

	const second = await create(f, first); await complete(f, second);
	const stale = (await project(f, first)).preview!;
	assert.equal(stale.snapshot_id, first.snapshot.id);
	assert.equal(stale.is_current, false);
	const history = (await f.app.inject({ url: `/project/${first.project.id}/snapshot`, headers: auth(f.token) })).json<{ items: Revision[] }>();
	assert.equal(history.items[0]!.preview, null);
	assert.equal(history.items[1]!.preview!.snapshot_id, first.snapshot.id);
	const updated = Buffer.concat([mp3, Buffer.from('new audio')]);
	await upload(f.app, second.sync.mixdown, updated);
	assert.equal((await project(f, first)).preview!.is_current, true, 'mixdowns may arrive after project completion');
	assert.deepEqual((await f.app.inject(relative((await project(f, first)).preview!.url))).rawPayload, updated);
	const old = (await f.app.inject({ url: `/project/${first.project.id}/snapshot/${first.snapshot.id}`, headers: auth(f.token) })).json<Revision>();
	assert.deepEqual((await f.app.inject(relative(old.preview!.url))).rawPayload, mp3);
});

await test('invalid optional previews are rejected without blocking a project save', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const created = await create(f);
	const invalid = await f.app.inject({ method: 'PUT', url: relative(created.sync.mixdown.url), headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.from('<html>not audio</html>') });
	assert.equal(invalid.statusCode, 422);
	assert.equal((await f.app.inject({ method: 'POST', url: relative(created.sync.mixdown.success) })).statusCode, 409);
	await complete(f, created);
	assert.equal((await project(f, created)).preview, null);
	await upload(f.app, created.sync.mixdown, mp3);
	assert.equal((await project(f, created)).preview!.mime, 'audio/mpeg');
});

await test('startup repairs legacy preview MIME types and hides unknown legacy containers', async t => {
	const f = await fixture(); let closeRestarted = async () => {};
	t.after(async () => { await closeRestarted(); await f.cleanup(); });
	const first = await create(f); await complete(f, first); await upload(f.app, first.sync.mixdown, mp3);
	const second = await create(f, first); await complete(f, second);
	const unknown = f.ctx.blobs.get(second.sync.mixdown.id)!;
	await writeFile(unknown.path, 'legacy opaque preview');
	f.ctx.db.run("UPDATE blobs SET state='ready',size=21 WHERE id=?", unknown.id);
	f.ctx.db.run("UPDATE blobs SET mime='audio/wav' WHERE kind='project-mixdown'");
	await f.app.close();
	const restarted = await createApp(f.ctx.config); closeRestarted = () => restarted.app.close();
	const info = (await restarted.app.inject({ url: `/project/${first.project.id}`, headers: auth(f.token) })).json<Project>();
	assert.equal(info.preview!.mime, 'audio/mpeg');
	assert.equal(info.preview!.snapshot_id, first.snapshot.id);
	assert.equal(info.preview!.is_current, false);
	assert.deepEqual((await restarted.app.inject(relative(info.preview!.url))).rawPayload, mp3);
	assert.equal(restarted.ctx.blobs.ready(unknown.id)!.mime, 'application/octet-stream');
	const revision = (await restarted.app.inject({ url: `/project/${first.project.id}/snapshot/${second.snapshot.id}`, headers: auth(f.token) })).json<Revision>();
	assert.equal(revision.preview, null);
});
