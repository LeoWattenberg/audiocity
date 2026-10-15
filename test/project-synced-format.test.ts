import assert from 'node:assert/strict';
import test from 'node:test';
import type { UploadDescriptor } from '../src/core.ts';
import { fixture, upload } from './helpers.ts';

interface Project {
	id: string;
	format: string;
	latest_synced_format: string;
	latest_synced_snapshot_id: string;
	size: number;
}
interface Created { project: Project; snapshot: { id: string }; sync: { file: UploadDescriptor } }

await test('archive listing identifies the synchronized format separately from a newer pending head', async t => {
	const f = await fixture();
	t.after(() => f.cleanup());
	const headers = { authorization: `Bearer ${f.token}` };
	const create = async (url: string, payload: object) => {
		const response = await f.app.inject({ method: 'POST', url, headers, payload });
		assert.equal(response.statusCode, 201, response.body);
		return response.json<Created>();
	};
	const first = await create('/project', { name: 'Changing generation', format: 'aup3', size: 116 });
	assert.equal(first.project.latest_synced_format, '');
	const bytes = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100)]);
	await upload(f.app, first.sync.file, bytes);
	const complete = await f.app.inject({ method: 'POST', url: `/project/${first.project.id}/snapshot/${first.snapshot.id}/sync`, headers });
	assert.equal(complete.statusCode, 200, complete.body);
	const next = await create(`/project/${first.project.id}/snapshot`, { head_snapshot_id: first.snapshot.id, format: 'aup4', size: 116 });
	const listed = await f.app.inject({ url: '/project?transport=file', headers });
	const project = listed.json<{ items: Project[] }>().items[0];
	assert.equal(project?.format, 'aup4');
	assert.equal(project?.latest_synced_snapshot_id, first.snapshot.id);
	assert.equal(project?.latest_synced_format, 'aup3');
	assert.equal(project?.size, bytes.length);
	await upload(f.app, next.sync.file, bytes);
	const synced = await f.app.inject({ method: 'POST', url: `/project/${first.project.id}/snapshot/${next.snapshot.id}/sync`, headers });
	assert.equal(synced.statusCode, 200, synced.body);
	const updated = await f.app.inject({ url: `/project/${first.project.id}`, headers });
	assert.equal(updated.json<Project>().latest_synced_format, 'aup4');
	assert.equal(updated.json<Project>().latest_synced_snapshot_id, next.snapshot.id);
});
