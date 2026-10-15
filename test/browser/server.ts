import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.ts';

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
	({ app } = await createApp({
		dataDir: directory, logger: false, publicUrl: `http://127.0.0.1:${port}`, port,
		adminEmail: 'browser@example.test', adminPassword: 'browser-admin-password',
	}));
	await app.listen({ port, host: '127.0.0.1' });
} catch (error) {
	await cleanup();
	throw error;
}
