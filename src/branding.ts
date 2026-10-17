import { createReadStream, existsSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';

export const brandIcons = `<link rel="icon" href="/assets/branding/audiocity.png" type="image/png" sizes="512x512">
<link rel="icon" href="/assets/branding/audiocity.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/assets/branding/audiocity.png" sizes="512x512">`;

export const brandHtml = '<a class="brand" href="/"><img src="/assets/branding/audiocity.svg" width="40" height="40" alt="">Audiocity</a>';

export const brandCss = `.brand{display:inline-flex;align-items:center;gap:.65rem;font-size:1.65rem;font-weight:750;line-height:1.2;text-decoration:none;color:inherit}.brand img{display:block;width:2.5rem;height:2.5rem;flex:none}`;

export function registerBrandAssets(app: FastifyInstance): void {
	const directory = existsSync(new URL('./assets/branding/', import.meta.url))
		? new URL('./assets/branding/', import.meta.url) : new URL('../assets/branding/', import.meta.url);
	for (const [name, type] of [['audiocity.svg', 'image/svg+xml'], ['audiocity.png', 'image/png']] as const) {
		app.get(`/assets/branding/${name}`, (_request, reply) => reply.type(type).send(createReadStream(new URL(name, directory))));
	}
}
