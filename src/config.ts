import { resolve } from 'node:path';
import { ApiError } from './core.ts';
import type { Config } from './core.ts';

function integer(value: string | undefined, fallback: number, name: string): number {
	const result = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${name} must be a positive integer.`);
	return result;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const port = integer(env.AUDIOCITY_PORT, 8080, 'AUDIOCITY_PORT');
	if (port > 65535) throw new Error('AUDIOCITY_PORT must be at most 65535.');
	const publicUrl = new URL(env.AUDIOCITY_PUBLIC_URL ?? `http://localhost:${port}`);
	if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password
		|| publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
		throw new ApiError(500, 'AUDIOCITY_PUBLIC_URL must be an HTTP(S) origin without a path or credentials.');
	}
	return {
		dataDir: resolve(env.AUDIOCITY_DATA_DIR ?? './data'), publicUrl: publicUrl.origin,
		...(env.AUDIOCITY_SHARED_DIR?.trim() ? { sharedDir: resolve(env.AUDIOCITY_SHARED_DIR) } : {}),
		host: env.AUDIOCITY_HOST ?? '0.0.0.0', port,
		registration: env.AUDIOCITY_REGISTRATION === 'true',
		corsOrigins: (env.AUDIOCITY_CORS_ORIGINS ?? publicUrl.origin).split(',').map(s => s.trim()).filter(Boolean),
		maxUploadBytes: integer(env.AUDIOCITY_MAX_UPLOAD_BYTES, 1024 ** 3, 'AUDIOCITY_MAX_UPLOAD_BYTES'),
		maxUserBytes: integer(env.AUDIOCITY_MAX_USER_BYTES, 20 * 1024 ** 3, 'AUDIOCITY_MAX_USER_BYTES'),
		uploadTtlSeconds: integer(env.AUDIOCITY_UPLOAD_TTL_SECONDS, 86400, 'AUDIOCITY_UPLOAD_TTL_SECONDS'),
		tokenTtlSeconds: integer(env.AUDIOCITY_TOKEN_TTL_SECONDS, 3600, 'AUDIOCITY_TOKEN_TTL_SECONDS'),
		adminEmail: env.AUDIOCITY_ADMIN_EMAIL ?? 'admin@audiocity.local',
		adminPassword: env.AUDIOCITY_ADMIN_PASSWORD || undefined,
		audacityClientId: env.AUDIOCITY_AUDACITY_CLIENT_ID ?? 'audiocity-desktop',
		audacityClientSecret: env.AUDIOCITY_AUDACITY_CLIENT_SECRET ?? 'audiocity-local-desktop',
		logger: env.NODE_ENV !== 'test',
	};
}
