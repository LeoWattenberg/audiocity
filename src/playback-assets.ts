import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { playbackClient } from './playback-client.ts';

/** Serve a fixed codec inventory, including the corresponding source and notices. */
export async function registerPlaybackAssets(app: FastifyInstance): Promise<void> {
	const directory = existsSync(new URL('./assets/wavpack/', import.meta.url))
		? new URL('./assets/wavpack/', import.meta.url) : new URL('../assets/wavpack/', import.meta.url);
	const manifest = JSON.parse(await readFile(new URL('source-manifest.json', directory), 'utf8')) as { sources: Record<string, string> };
	app.get('/playback.js', (_request, reply) => reply.type('text/javascript; charset=utf-8').send(playbackClient));
	const paths = ['worker.js', 'decode.js', 'wavpack.wasm', 'source-manifest.json', 'NOTICE.md', ...Object.keys(manifest.sources)];
	for (const path of paths) {
		if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..')) throw new Error('Invalid codec source inventory.');
		const file = fileURLToPath(new URL(path, directory));
		const type = path.endsWith('.wasm') ? 'application/wasm' : path.endsWith('.js') ? 'text/javascript; charset=utf-8'
			: path.endsWith('.json') ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8';
		app.get(`/assets/wavpack/${path}`, (_request, reply) => reply.type(type).send(createReadStream(file)));
	}
}
