import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
const staging = mkdtempSync(join(tmpdir(), 'audiocity-package-test-'));
const server = createServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const address = server.address();
assert.ok(address && typeof address !== 'string');
const port = address.port;
await new Promise<void>(resolve => { server.close(() => { resolve(); }); });
const url = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString('hex');
const env = { ...process.env, NODE_ENV: 'test', AUDIOCITY_DATA_DIR: join(staging, 'data'), AUDIOCITY_HOST: '127.0.0.1',
	AUDIOCITY_PORT: String(port), AUDIOCITY_PUBLIC_URL: url, AUDIOCITY_ADMIN_EMAIL: 'admin@audiocity.local', AUDIOCITY_ADMIN_PASSWORD: password,
	AUDIOCITY_URL: url, AUDIOCITY_SMOKE_PASSWORD: password, AUDIOCITY_SMOKE_EMAIL: 'admin@audiocity.local' };
let child: ReturnType<typeof spawn> | undefined;
try {
	execFileSync('tar', ['-xzf', join(root, `dist/release/audiocity-${version}-node.tar.gz`), '-C', staging]);
	const directory = join(staging, `audiocity-${version}-node`);
	execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: directory, stdio: 'inherit' });
	child = spawn(process.execPath, ['dist/main.js'], { cwd: directory, env, stdio: 'inherit' });
	let healthy = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.exitCode !== null) throw new Error('Packaged server exited before becoming healthy.');
		try {
			const response = await fetch(`${url}/health`);
			assert.equal((await response.json() as { version: string }).version, version);
			healthy = response.ok;
		} catch { /* Wait for startup. */ }
		if (healthy) break;
		await setTimeout(100);
	}
	assert.ok(healthy, 'Packaged server did not become healthy.');
	const source = await fetch(`${url}/source.tar.gz`);
	assert.equal(source.status, 200);
	assert.deepEqual(Buffer.from(await source.arrayBuffer()), readFileSync(join(root, 'dist/source.tar.gz')));
	execFileSync(process.execPath, ['scripts/smoke.ts'], { cwd: root, env, stdio: 'inherit' });
	process.stdout.write('Compiled Node.js package passed with production dependencies and corresponding source.\n');
} finally {
	if (child && child.exitCode === null) {
		const stopped = once(child, 'exit');
		child.kill('SIGTERM');
		await stopped;
	}
	rmSync(staging, { recursive: true, force: true });
}
