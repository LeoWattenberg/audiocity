import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { UploadDescriptor } from '../src/core.ts';

const origin = new URL(process.env.AUDIOCITY_URL ?? 'http://localhost:8080').origin;
const email = process.env.AUDIOCITY_SMOKE_EMAIL ?? 'admin@audiocity.local';
const password = process.env.AUDIOCITY_SMOKE_PASSWORD;
if (!password) throw new Error('Set AUDIOCITY_SMOKE_PASSWORD to an existing account password.');
let token = '';
async function call<T>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(new URL(path, origin), {
		...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
	});
	assert.ok(response.ok, `${response.status}: ${await response.clone().text()}`);
	return response.status === 204 ? undefined as T : await response.json() as T;
}
async function put(descriptor: UploadDescriptor, bytes: Buffer): Promise<void> {
	const target = new URL(descriptor.url); assert.equal(target.origin, origin, 'Set PUBLIC_URL to the reachable server origin.');
	const response = await fetch(target, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(bytes) });
	assert.ok(response.ok, await response.text());
	assert.ok((await fetch(descriptor.success, { method: 'POST' })).ok);
}
interface Created {
	project: { id: string }; snapshot: { id: string };
	sync: { file: UploadDescriptor; blocks: UploadDescriptor[] };
}
const created: { kind: 'audio' | 'project'; id: string }[] = [];
try {
	assert.equal((await call<{ status: string }>('/health')).status, 'ok');
	token = (await call<{ access_token: string }>('/auth/token', { method: 'POST', body: JSON.stringify({ grant_type: 'password', username: email, password, scope: 'all' }) })).access_token;
	const wav = Buffer.alloc(48); wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
	wav.write('data', 36); wav.writeUInt32LE(4, 40);
	const audio = await call<UploadDescriptor & { audio: { id: string } }>('/v1/audio/create', { method: 'POST', body: JSON.stringify({ name: 'Audiocity smoke.wav', mime: 'audio/wav', size: wav.length }) });
	created.push({ kind: 'audio', id: audio.audio.id }); await put(audio, wav);
	const view = await call<{ play: { url: string } }>(`/v1/audio/view?id=${audio.audio.id}`);
	const range = await fetch(view.play.url, { headers: { Range: 'bytes=0-3' } });
	assert.equal(range.status, 206); assert.equal(await range.text(), 'RIFF');
	const block = Buffer.from('opaque Audacity block transport fixture');
	const hash = createHash('sha256').update(block).digest('hex');
	const project = await call<Created>('/project', { method: 'POST', body: JSON.stringify({ name: 'Audiocity smoke project', blocks: [hash] }) });
	created.push({ kind: 'project', id: project.project.id });
	await put(project.sync.file, Buffer.from('opaque Audacity serialized metadata fixture'));
	for (const upload of project.sync.blocks) await put(upload, block);
	const synced = await call<{ file_url: string }>(`/project/${project.project.id}/snapshot/${project.snapshot.id}/sync`, { method: 'POST' });
	assert.equal(await (await fetch(synced.file_url)).text(), 'opaque Audacity serialized metadata fixture');
	for (const format of ['aup3', 'aup4']) {
		const archive = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100)]);
		const result = await call<Created>('/project', { method: 'POST', body: JSON.stringify({ name: `Smoke ${format}`, format, size: archive.length }) });
		created.push({ kind: 'project', id: result.project.id }); await put(result.sync.file, archive);
		const complete = await call<{ file_url: string }>(`/project/${result.project.id}/snapshot/${result.snapshot.id}/sync`, { method: 'POST' });
		assert.deepEqual(Buffer.from(await (await fetch(complete.file_url)).arrayBuffer()), archive);
	}
	process.stdout.write('Smoke passed: health, login, WAV upload/range, block sync, AUP3/AUP4 archive round trips.\n');
} finally {
	for (const resource of created.reverse()) {
		await call(resource.kind === 'audio' ? `/v1/audio/delete?id=${resource.id}` : `/project/${resource.id}`, { method: resource.kind === 'audio' ? 'POST' : 'DELETE' });
	}
}
