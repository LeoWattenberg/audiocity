import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../src/app.ts';
import type { UploadDescriptor } from '../src/core.ts';
import { createUser, fixture, relative, upload } from './helpers.ts';

interface Created {
	project: { id: string; username: string; name: string };
	snapshot: { id: string };
	sync: { file: UploadDescriptor; blocks: UploadDescriptor[] };
}
interface Snapshot { file_url: string; blocks: { hash: string; url: string }[] }

await test('native project IDs work in Audacity 3 owner-cache keys, attached databases and savepoints', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const headers = { authorization: `Bearer ${f.token}` };
	const response = await f.app.inject({ method: 'POST', url: '/project', headers, payload: { name: 'Cold download', blocks: [] } });
	assert.equal(response.statusCode, 200, response.body);
	const { project } = response.json<Created>();
	assert.match(project.id, /^[1-9]\d*$/);
	const cache = new DatabaseSync(':memory:');
	try {
		// These identifiers and the INTEGER key match Audacity 3.7.9's downloader.
		cache.exec('CREATE TABLE project_users (project_id INTEGER PRIMARY KEY, user_name TEXT)');
		cache.prepare('INSERT OR REPLACE INTO project_users (project_id,user_name) VALUES (?,?)').run(project.id, project.username);
		const alias = `s_${project.id}`;
		cache.prepare('ATTACH DATABASE ? AS ?').run(':memory:', alias);
		cache.exec(`CREATE TABLE ${alias}.project (id INTEGER PRIMARY KEY,dict BLOB,doc BLOB)`);
		cache.exec(`CREATE TABLE ${alias}.sampleblocks (blockid INTEGER PRIMARY KEY)`);
		cache.exec(`SAVEPOINT p_${project.id}`);
		cache.prepare(`INSERT INTO ${alias}.project (id,dict,doc) VALUES (1,?,?)`).run(Buffer.from('dictionary'), Buffer.from('document'));
		cache.exec(`RELEASE p_${project.id}`);
		cache.exec(`SAVEPOINT d_${project.id}`);
		cache.prepare(`SELECT blockid FROM ${alias}.sampleblocks`).all();
		cache.exec(`RELEASE d_${project.id}`);
		assert.equal((cache.prepare('SELECT user_name FROM project_users WHERE project_id=?').get(project.id) as { user_name: string }).user_name, project.username);
	} finally { cache.close(); }
	assert.equal((await f.app.inject({ method: 'DELETE', url: `/project/${project.id}`, headers })).statusCode, 204);
	const next = await f.app.inject({ method: 'POST', url: '/project', headers, payload: { blocks: [] } });
	assert.equal(next.statusCode, 200);
	assert.notEqual(next.json<Created>().project.id, project.id, 'Deleted IDs must not identify a different project in a desktop cache.');
});

await test('existing UUID native projects gain stable numeric aliases without changing archives, revisions or stored bytes', async t => {
	const f = await fixture();
	let closeRestarted = async () => {};
	t.after(async () => { await closeRestarted(); await f.cleanup(); });
	const headers = { authorization: `Bearer ${f.token}` };
	const response = await f.app.inject({ method: 'POST', url: '/project', headers, payload: { name: 'Existing native project', blocks: ['AABB'] } });
	const created = response.json<Created>();
	const metadata = Buffer.from('existing native serialized project metadata');
	const block = Buffer.from('existing native WavPack transport bytes');
	await upload(f.app, created.sync.file, metadata);
	await upload(f.app, created.sync.blocks[0]!, block);
	assert.equal((await f.app.inject({ method: 'POST', url: `/project/${created.project.id}/snapshot/${created.snapshot.id}/sync`, headers })).statusCode, 204);
	const stored = f.ctx.db.get<{ project_id: string }>('SELECT project_id FROM native_project_ids WHERE id=?', created.project.id)!;
	assert.match(stored.project_id, /^[a-f\d-]{36}$/);
	const archive = (await f.app.inject({ method: 'POST', url: '/project', headers, payload: { name: 'Archive', format: 'aup3' } })).json<Created>();
	assert.match(archive.project.id, /^[a-f\d-]{36}$/);
	const other = await createUser(f.app, f.token);
	// A pre-fix data volume has UUID projects and no native ID mapping table.
	f.ctx.db.exec('DROP TABLE native_project_ids');
	await f.app.close();
	const migrated = await createApp(f.ctx.config); closeRestarted = () => migrated.app.close();
	const listed = await migrated.app.inject({ url: '/project', headers });
	assert.equal(listed.statusCode, 200);
	const project = listed.json<{ items: Created['project'][] }>().items[0]!;
	assert.match(project.id, /^[1-9]\d*$/);
	assert.equal(project.name, created.project.name);
	for (const id of [project.id, stored.project_id]) {
		const info = await migrated.app.inject({ url: `/project/${id}`, headers });
		assert.equal(info.statusCode, 200);
		assert.equal(info.json<Created['project']>().id, project.id);
		const snapshotPath = `/project/${id}/snapshot/${created.snapshot.id}`;
		const snapshot = await migrated.app.inject({ url: snapshotPath, headers });
		assert.equal(snapshot.statusCode, 200);
		const downloads = snapshot.json<Snapshot>();
		assert.deepEqual((await migrated.app.inject(relative(downloads.file_url))).rawPayload, metadata);
		assert.deepEqual((await migrated.app.inject(relative(downloads.blocks[0]!.url))).rawPayload, block);
		const foreign = { authorization: `Bearer ${other.token}` };
		assert.equal((await migrated.app.inject({ url: `/project/${id}`, headers: foreign })).statusCode, 404);
		assert.equal((await migrated.app.inject({ url: snapshotPath, headers: foreign })).statusCode, 404);
	}
	const archived = await migrated.app.inject({ url: `/project/${archive.project.id}`, headers });
	assert.equal(archived.json<Created['project']>().id, archive.project.id);
	await migrated.app.close();
	const restarted = await createApp(f.ctx.config); closeRestarted = () => restarted.app.close();
	assert.equal((await restarted.app.inject({ url: `/project/${stored.project_id}`, headers })).json<Created['project']>().id, project.id);
	const revision = await restarted.app.inject({ method: 'POST', url: `/project/${stored.project_id}/snapshot`, headers, payload: { head_snapshot_id: created.snapshot.id, blocks: ['aabb'] } });
	assert.equal(revision.statusCode, 200);
	assert.equal(revision.json<Created>().project.id, project.id);
	assert.deepEqual(revision.json<Created>().sync.blocks, []);
	assert.equal((await restarted.app.inject({ method: 'DELETE', url: `/project/${project.id}`, headers })).statusCode, 204);
	assert.equal((await restarted.app.inject({ url: `/project/${stored.project_id}`, headers })).statusCode, 404);
	assert.equal((await restarted.app.inject({ url: `/project/${project.id}`, headers })).statusCode, 404);
});
