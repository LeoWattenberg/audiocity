import { mkdir } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Authentication, registerAuthRoutes } from './auth.ts';
import { registerAudioRoutes } from './audio.ts';
import { BlobStorage, registerBlobRoutes } from './blobs.ts';
import { readConfig } from './config.ts';
import { ApiError } from './core.ts';
import type { Config, Context } from './core.ts';
import { Database } from './database.ts';
import { registerConsoleRoutes } from './console.ts';
import { registerProjectRoutes } from './projects.ts';

export async function createApp(overrides: Partial<Config> = {}) {
	const config = { ...readConfig(), ...overrides };
	await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
	const db = new Database(join(config.dataDir, 'audiocity.sqlite'));
	const app = Fastify({
		logger: config.logger ? { redact: ['req.headers.authorization', 'req.headers.cookie'] } : false,
		logController: new LogController({ disableRequestLogging: true }), bodyLimit: 8 * 1024 * 1024,
		requestTimeout: 30 * 60 * 1000, connectionTimeout: 30 * 60 * 1000,
	});
	app.addHook('onClose', () => { db.close(); });
	try {
		const auth = new Authentication(config, db);
		const bootstrapPassword = await auth.initialize();
		const blobs = new BlobStorage(db, config); await blobs.initialize();
		const ctx: Context = { config, db, auth, blobs };
		await app.register(cors, {
			origin: config.corsOrigins, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
			allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'X-Audacity-Instance-Id', 'Accept-Language'],
			exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'ETag'],
		});
		await app.register(rateLimit, { global: false });
		app.addHook('onRoute', route => {
			if (route.url.startsWith('/auth/') && route.method !== 'GET' && route.method !== 'HEAD') {
				route.config = { ...route.config, rateLimit: route.config?.rateLimit ?? { max: 60, timeWindow: '1 minute' } };
			}
		});
		app.addHook('onSend', (request, reply, _payload, done) => {
			// Audacity 3 caches POST handles when it sees Keep-Alive, but leaves
			// CURLOPT_POSTFIELDS set after an empty POST, corrupting the next JSON save.
			// Closing POST connections also suppresses Node's implicit Keep-Alive header.
			if (request.method === 'POST') reply.header('connection', 'close');
			reply.header('x-content-type-options', 'nosniff').header('referrer-policy', 'no-referrer')
				.header('x-frame-options', 'DENY').header('cache-control', 'no-store');
			done();
		});
		app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
			const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
			if (status >= 500) app.log.error({ err: error }, 'Request failed');
			void reply.code(status).send({ status, name: error instanceof ApiError ? error.errorName : 'Error', message: status >= 500 ? 'Internal server error.' : error.message });
		});
		app.setNotFoundHandler((_request, reply) => reply.code(404).send({ status: 404, name: 'NotFound', message: 'Route not found.' }));
		app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
			done(null, Object.fromEntries(new URLSearchParams(String(body))));
		});
		app.get('/health', () => { db.get('SELECT 1'); return { status: 'ok', service: 'audiocity', version: '0.1.0' }; });
		app.get('/source.tar.gz', (_request, reply) => {
			const archive = join(import.meta.dirname, '../dist/source.tar.gz');
			if (!existsSync(archive)) throw new ApiError(404, 'Run npm run build to package the source archive.');
			return reply.type('application/gzip').header('Content-Disposition', 'attachment; filename="audiocity-source.tar.gz"').send(createReadStream(archive));
		});
		app.get('/.well-known/audiocity', () => ({
			name: 'Audiocity', version: '0.1.0', url: config.publicUrl,
			features: ['audio-uploads', 'audacity-block-sync', 'project-audio-previews', 'aup3-archives', 'aup4-archives', 'oauth-pkce'],
			limits: { max_upload_bytes: config.maxUploadBytes, max_user_bytes: config.maxUserBytes },
		}));
		await registerBlobRoutes(app, blobs);
		registerAuthRoutes(app, ctx);
		registerAudioRoutes(app, ctx);
		await registerProjectRoutes(app, ctx);
		registerConsoleRoutes(app, ctx);
		await app.ready();
		return { app, ctx, bootstrapPassword };
	} catch (error) { await app.close(); throw error; }
}
