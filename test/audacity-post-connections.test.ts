import assert from 'node:assert/strict';
import { Agent, request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import test from 'node:test';
import type { UploadDescriptor } from '../src/core.ts';
import { fixture, upload } from './helpers.ts';

// Use real sockets: Node adds Keep-Alive while writing HTTP headers, after onSend.
await test('POST responses prevent Audacity 3 handle reuse across repeated dirty saves', async t => {
	const f = await fixture(); t.after(() => f.cleanup());
	const origin = await f.app.listen({ host: '127.0.0.1', port: 0 });
	const agent = new Agent({ keepAlive: true }); t.after(() => agent.destroy());
	async function send(path: string, method = 'GET', body?: Buffer) {
		return new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
			const req = request(origin + path, { method, agent, headers: { authorization: `Bearer ${f.token}`, ...(body ? { 'content-type': 'application/json', 'content-length': body.length } : {}) } }, res => {
				const chunks: Buffer[] = [];
				res.on('data', (chunk: Buffer) => chunks.push(chunk)); res.on('error', reject);
				res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString() }));
			});
			req.on('error', reject); req.end(body);
		});
	}
	interface Created { project: { id: string; name: string }; snapshot: { id: string }; sync: { file: UploadDescriptor } }
	let current = JSON.parse((await send('/project', 'POST', Buffer.from('{"name":"Saved project","blocks":[]}'))).body) as Created;
	const root = `/project/${current.project.id}`;
	for (let i = 0; i < 3; i++) {
		await upload(f.app, current.sync.file, Buffer.from(`changed project metadata ${i}`));
		const completed = await send(`${root}/snapshot/${current.snapshot.id}/sync`, 'POST');
		assert.equal(completed.status, 204);
		assert.equal(completed.headers.connection, 'close');
		assert.equal(completed.headers['keep-alive'], undefined);
		const response = await send(`${root}/snapshot`, 'POST', Buffer.from(JSON.stringify({ head_snapshot_id: current.snapshot.id, blocks: [] })));
		assert.equal(response.status, 200, response.body);
		assert.equal(response.headers.connection, 'close');
		assert.equal(response.headers['keep-alive'], undefined);
		current = JSON.parse(response.body) as Created;
		assert.equal(current.project.name, 'Saved project');
	}
	const malformed = await send(`${root}/snapshot`, 'POST', Buffer.alloc(204));
	assert.equal(malformed.status, 400, 'corrupt JSON remains rejected');
	assert.equal(malformed.headers.connection, 'close', 'already poisoned handles are discarded after an error');
	assert.equal(malformed.headers['keep-alive'], undefined);
	const info = await send(root);
	assert.equal(info.status, 200);
	assert.equal(info.headers.connection, 'keep-alive', 'downloads and metadata GETs retain connection reuse');
	assert.equal((JSON.parse(info.body) as { head: { id: string } }).head.id, current.snapshot.id);
});
