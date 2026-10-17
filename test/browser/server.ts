import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.ts';
import { Authentication } from '../../src/auth.ts';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4328);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PLAYWRIGHT_PORT must be between 1 and 65535.');
const directory = await mkdtemp(join(tmpdir(), 'audiocity-browser-'));
let app: FastifyInstance | undefined;
let stopping = false;

async function cleanup(): Promise<void> {
	await app?.close();
	await rm(directory, { recursive: true, force: true });
}
function stop(): void {
	if (stopping) return;
	stopping = true;
	void cleanup().then(() => { process.exit(0); }).catch(error => {
		console.error(error);
		process.exit(1);
	});
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
	const sharedDirectory = join(directory, 'shared');
	await mkdir(sharedDirectory);
	const wav = Buffer.alloc(48);
	wav.write('RIFF'); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
	await writeFile(join(sharedDirectory, 'Shared ambience.wav'), wav);
	const fixture = await createApp({
		dataDir: directory, sharedDir: sharedDirectory, logger: false, publicUrl: `http://127.0.0.1:${port}`, port,
		adminEmail: 'browser@example.test', adminPassword: 'browser-admin-password',
		audacityClientId: 'browser-audacity', audacityClientSecret: 'browser-desktop-secret',
	});
	app = fixture.app;
	if (!(fixture.ctx.auth instanceof Authentication)) throw new Error('The browser fixture requires local authentication.');
	await fixture.ctx.auth.createUser({ email: 'oauth-browser@example.test', password: 'oauth-browser-password' });
	await fixture.ctx.auth.createUser({ email: 'library-browser@example.test', password: 'library-browser-password' });
	await fixture.ctx.auth.createUser({ email: 'library-listener@example.test', password: 'library-listener-password' });
	await app.listen({ port, host: '127.0.0.1' });
} catch (error) {
	await cleanup();
	throw error;
}
