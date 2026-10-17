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
	for (const [path, type] of [
		['/playback.js', 'text/javascript'], ['/assets/wavpack/worker.js', 'text/javascript'],
		['/assets/wavpack/decode.js', 'text/javascript'], ['/assets/wavpack/wavpack.wasm', 'application/wasm'],
		['/assets/wavpack/native/audiocity_decode.c', 'text/plain'], ['/assets/wavpack/NOTICE.md', 'text/plain'],
		['/assets/wavpack/licenses/WAVPACK.txt', 'text/plain'],
	] as const) {
		const asset = await fetch(`${url}${path}`);
		assert.equal(asset.status, 200, `Packaged codec asset: ${path}`);
		assert.ok(asset.headers.get('content-type')?.startsWith(type));
		if (path.endsWith('.wasm')) {
			assert.deepEqual(Buffer.from(await asset.arrayBuffer()), readFileSync(join(root, 'assets/wavpack/wavpack.wasm')));
		} else assert.ok((await asset.text()).length > 0);
	}
	const sourceInventory = execFileSync('tar', ['-tzf', join(root, 'dist/source.tar.gz')], { encoding: 'utf8' });
	for (const path of ['assets/wavpack/native/audiocity_decode.c', 'assets/wavpack/native/unpack.c',
		'assets/wavpack/source-manifest.json', 'assets/wavpack/licenses/WAVPACK.txt', 'scripts/build-wavpack-wasm.ts']) {
		assert.ok(sourceInventory.split('\n').includes(path), `Corresponding source includes ${path}`);
	}
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
