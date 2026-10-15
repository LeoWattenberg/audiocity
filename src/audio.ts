import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, now, objectBody, pageQuery, requiredString } from './core.ts';
import type { Context, User } from './core.ts';
import { audioFormat, validateAudio } from './audio-formats.ts';

interface AudioRecord {
	id: string;
	owner_id: string;
	blob_id: string;
	name: string;
	title: string;
	slug: string;
	category: string;
	description: string;
	tags: string;
	license: string;
	visibility: string;
	is_downloadable: number;
	duration: number;
	created: number;
	updated: number;
}

const categories = new Set(['music', 'podcast', 'voice-over', 'sound-design', 'cover', 'beats', 'audiobook', 'recording', 'other']);
const licenses = new Set(['none', 'arr', 'cc-0', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd']);
const mutableFields = new Set(['title', 'slug', 'category', 'description', 'tags', 'license', 'is_listed', 'is_downloadable', 'visibility', 'public']);

function boolean(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') throw new ApiError(422, `${field} must be a boolean.`, 'ValidationError');
	return value;
}

function slug(value: string): string {
	return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'audio';
}

function validateMetadata(body: Record<string, unknown>, current: AudioRecord): AudioRecord {
	const result = { ...current };
	if ('title' in body) result.title = requiredString(body.title, 'title', 256);
	if ('slug' in body) {
		result.slug = requiredString(body.slug, 'slug', 100);
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.slug)) throw new ApiError(422, 'slug must contain lowercase letters, numbers, and hyphens.', 'ValidationError');
	}
	if ('description' in body) {
		if (typeof body.description !== 'string' || body.description.length > 500) throw new ApiError(422, 'description must contain at most 500 characters.', 'ValidationError');
		result.description = body.description;
	}
	if ('tags' in body) {
		if (!Array.isArray(body.tags) || body.tags.length > 50) throw new ApiError(422, 'tags must be an array of at most 50 strings.', 'ValidationError');
		result.tags = JSON.stringify(body.tags.map(tag => requiredString(tag, 'tag', 64)));
	}
	for (const [key, values] of [['category', categories], ['license', licenses]] as const) {
		if (key in body) {
			const value = requiredString(body[key], key, 32);
			if (!values.has(value)) throw new ApiError(422, `Unsupported ${key}.`, 'ValidationError');
			result[key] = value;
		}
	}
	if ('is_listed' in body) result.visibility = boolean(body.is_listed, 'is_listed') ? 'public' : 'unlisted';
	if ('public' in body) result.visibility = boolean(body.public, 'public') ? 'public' : 'unlisted';
	if ('visibility' in body) {
		if (typeof body.visibility !== 'string' || !['private', 'unlisted', 'public'].includes(body.visibility)) throw new ApiError(422, 'visibility must be private, unlisted, or public.', 'ValidationError');
		result.visibility = body.visibility;
	}
	if ('is_downloadable' in body) result.is_downloadable = Number(boolean(body.is_downloadable, 'is_downloadable'));
	return result;
}

export function registerAudioRoutes(app: FastifyInstance, ctx: Context): void {
	ctx.db.exec(`CREATE TABLE IF NOT EXISTS audio (
		id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, blob_id TEXT NOT NULL,
		name TEXT NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL, category TEXT NOT NULL,
		description TEXT NOT NULL, tags TEXT NOT NULL, license TEXT NOT NULL,
		visibility TEXT NOT NULL, is_downloadable INTEGER NOT NULL,
		duration INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL,
		UNIQUE(owner_id, slug)
	);
	CREATE INDEX IF NOT EXISTS audio_owner_created ON audio(owner_id, created);
	CREATE INDEX IF NOT EXISTS audio_visibility ON audio(visibility);`);
	ctx.blobs.setValidator('audio', async (blob, path) => {
		const duration = await validateAudio(path, blob.mime);
		ctx.db.run('UPDATE audio SET duration=? WHERE id=?', duration, blob.resource_id);
	});

	function owner(request: FastifyRequest): User { return ctx.auth.requireUser(request, 'audio'); }
	function find(id: string, userId?: string): AudioRecord {
		const row = id.startsWith('slug:') && userId
			? ctx.db.get<AudioRecord>('SELECT * FROM audio WHERE owner_id=? AND slug=?', userId, id.slice(5))
			: ctx.db.get<AudioRecord>('SELECT * FROM audio WHERE id=?', id);
		if (!row || (userId && row.owner_id !== userId)) throw new ApiError(404, 'Audio not found.', 'NotFound');
		return row;
	}
	function queryId(request: FastifyRequest): string {
		return requiredString(objectBody(request.query).id, 'id');
	}
	function visible(request: FastifyRequest, id: string, download = false): AudioRecord {
		const row = find(id);
		const user = request.headers.authorization ? owner(request) : undefined;
		if (user?.id === row.owner_id) return row;
		if (row.visibility === 'private' || !ctx.blobs.ready(row.blob_id) || (download && !row.is_downloadable)) {
			throw new ApiError(404, 'Audio not found.', 'NotFound');
		}
		return row;
	}
	function metadata(row: AudioRecord, legacyList = false) {
		const user = ctx.auth.findUser(row.owner_id);
		const blob = ctx.blobs.get(row.blob_id);
		const ready = ctx.blobs.ready(row.blob_id);
		const url = ready ? ctx.blobs.downloadUrl(row.blob_id) : '';
		return {
			id: row.id, title: row.title, slug: row.slug, name: row.name,
			category: row.category, description: row.description, tags: JSON.parse(row.tags) as string[], license: row.license,
			visibility: row.visibility, is_public: row.visibility === 'public', is_listed: row.visibility === 'public',
			is_downloadable: Boolean(row.is_downloadable), status: ready ? 'ready' : blob?.state === 'failed' ? 'failed' : 'pending',
			author_name: user?.name ?? '', username: user?.username ?? '',
			author: legacyList ? user?.name ?? '' : { id: row.owner_id },
			created: row.created, date_created: row.created, date_updated: row.updated,
			image: '', source: { size: ready?.size ?? 0, duration: row.duration, mime: blob?.mime ?? '' },
			play: { url, duration: row.duration, waveform: '' },
			url: `${ctx.config.publicUrl}/public/audio/${row.id}`,
		};
	}
	function ensureUnique(row: AudioRecord): void {
		if (ctx.db.get('SELECT id FROM audio WHERE owner_id=? AND slug=? AND id<>?', row.owner_id, row.slug, row.id)) {
			throw new ApiError(409, 'This audio slug is already in use.', 'Conflict');
		}
	}

	async function create(request: FastifyRequest) {
		const user = owner(request);
		const body = objectBody(request.body);
		const mime = requiredString(body.mime, 'mime', 100);
		audioFormat(mime);
		if (!Number.isSafeInteger(body.size) || Number(body.size) < 1 || Number(body.size) > ctx.config.maxUploadBytes) {
			throw new ApiError(422, `size must be between 1 and ${ctx.config.maxUploadBytes} bytes.`, 'ValidationError');
		}
		const name = body.name === undefined ? 'Untitled audio' : requiredString(body.name, 'name', 256);
		const title = name.replace(/\.[^.]{1,8}$/, '') || name;
		let row = validateMetadata(body, {
			id: randomUUID(), owner_id: user.id, blob_id: '', name, title, slug: slug(title),
			category: 'other', description: '', tags: '[]', license: 'none', visibility: 'private',
			is_downloadable: 0, duration: 0, created: now(), updated: now(),
		});
		if (body.slug === undefined) {
			const base = row.slug;
			for (let index = 2; ctx.db.get('SELECT id FROM audio WHERE owner_id=? AND slug=?', user.id, row.slug); index++) row.slug = `${base}-${index}`;
		}
		ensureUnique(row);
		const policy = ctx.blobs.create(user.id, {
			kind: 'audio', resourceId: row.id, mime, expectedSize: Number(body.size),
		});
		row = { ...row, blob_id: policy.id };
		try {
			ctx.db.run(`INSERT INTO audio (id,owner_id,blob_id,name,title,slug,category,description,tags,license,visibility,is_downloadable,duration,created,updated)
				VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, row.id, row.owner_id, row.blob_id, row.name, row.title, row.slug, row.category,
				row.description, row.tags, row.license, row.visibility, row.is_downloadable, row.duration, row.created, row.updated);
		} catch (error) { await ctx.blobs.remove(policy.id); throw error; }
		const audio = metadata(row);
		return { ...policy, audio, extra: { audio } };
	}

	for (const url of ['/v1/audio/create', '/audio']) app.post(url, async (request, reply) => reply.code(201).send(await create(request)));

	app.get('/v1/search', { config: { rateLimit: {
		max: 60, timeWindow: '1 minute', keyGenerator: request => owner(request).id,
	} } }, request => {
		owner(request);
		const query = objectBody(request.query);
		const search = query.query ?? '';
		const types = query.types ?? '';
		const pageValue = query.page ?? '1';
		if (typeof search !== 'string' || search.length > 256 || typeof types !== 'string'
			|| typeof pageValue !== 'string' || !/^[1-9]\d{0,5}$/.test(pageValue)
			|| (types && types.split(',').some(type => !['audio', 'author', 'collection'].includes(type)))) {
			throw new ApiError(422, 'Supply a query of at most 256 characters, valid result types and a positive page.', 'ValidationError');
		}
		if (types && !types.split(',').includes('audio')) return [];
		const term = search.trim();
		const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
		const matching = term.startsWith('#')
			? 'EXISTS (SELECT 1 FROM json_each(audio.tags) WHERE value=? COLLATE NOCASE)'
			: `(audio.title LIKE ? ESCAPE '\\' OR audio.description LIKE ? ESCAPE '\\' OR users.name LIKE ? ESCAPE '\\'
				OR EXISTS (SELECT 1 FROM json_each(audio.tags) WHERE value LIKE ? ESCAPE '\\'))`;
		const params = term.startsWith('#') ? [term.slice(1)] : [pattern, pattern, pattern, pattern];
		const rows = ctx.db.all<AudioRecord>(`SELECT audio.* FROM audio JOIN users ON users.id=audio.owner_id
			WHERE audio.visibility='public' AND audio.blob_id IN (SELECT id FROM blobs WHERE state='ready') AND ${matching}
			ORDER BY audio.created DESC,audio.rowid DESC LIMIT 10 OFFSET ?`, ...params, (Number(pageValue) - 1) * 10);
		return rows.map(row => ({ type: 'audio', model: metadata(row) }));
	});

	function list(request: FastifyRequest, legacy: boolean) {
		const user = owner(request);
		const query = objectBody(request.query);
		const { page, perPage, search } = pageQuery(request.query);
		const sort = query.sort ?? 'newest';
		if (typeof sort !== 'string' || !['newest', 'oldest', 'az'].includes(sort)) throw new ApiError(422, 'sort must be newest, oldest, or az.', 'ValidationError');
		const order = sort === 'az' ? 'title COLLATE NOCASE ASC,id ASC' : `created ${sort === 'oldest' ? 'ASC' : 'DESC'},rowid ${sort === 'oldest' ? 'ASC' : 'DESC'}`;
		const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
		const total = ctx.db.get<{ count: number }>("SELECT count(*) AS count FROM audio WHERE owner_id=? AND title LIKE ? ESCAPE '\\'", user.id, pattern)?.count ?? 0;
		const rows = ctx.db.all<AudioRecord>(`SELECT * FROM audio WHERE owner_id=? AND title LIKE ? ESCAPE '\\' ORDER BY ${order} LIMIT ? OFFSET ?`, user.id, pattern, perPage, (page - 1) * perPage);
		const items = rows.map(row => metadata(row, legacy));
		return legacy ? { items, pagination: { total, pages: Math.ceil(total / perPage), page, size: perPage } } : items;
	}
	app.get('/v1/audio/list', request => list(request, false));
	app.get('/my/audio', request => list(request, true));
	app.get('/v1/audio/view', request => metadata(find(queryId(request), owner(request).id)));
	app.get<{ Params: { id: string } }>('/audio/:id', request => metadata(visible(request, request.params.id)));
	app.get<{ Params: { id: string } }>('/public/audio/:id', request => {
		const row = find(request.params.id);
		if (row.visibility === 'private' || !ctx.blobs.ready(row.blob_id)) throw new ApiError(404, 'Audio not found.', 'NotFound');
		return metadata(row);
	});
	app.get('/public/audio', request => {
		const { page, perPage } = pageQuery(request.query);
		const where = "visibility='public' AND blob_id IN (SELECT id FROM blobs WHERE state='ready')";
		const total = ctx.db.get<{ count: number }>(`SELECT count(*) AS count FROM audio WHERE ${where}`)?.count ?? 0;
		const rows = ctx.db.all<AudioRecord>(`SELECT * FROM audio WHERE ${where} ORDER BY created DESC,rowid DESC LIMIT ? OFFSET ?`, perPage, (page - 1) * perPage);
		return { items: rows.map(row => metadata(row)), pagination: { total, pages: Math.ceil(total / perPage), page, size: perPage } };
	});
	app.get<{ Params: { id: string } }>('/download/:id', request => {
		const row = visible(request, request.params.id, true);
		const blob = ctx.blobs.ready(row.blob_id);
		if (!blob) throw new ApiError(409, 'The audio upload is not ready.', 'Conflict');
		return { items: [{ format: audioFormat(blob.mime), url: ctx.blobs.downloadUrl(blob.id), size: blob.size, source: true }] };
	});

	app.patch('/v1/audio/update', request => {
		const row = find(queryId(request), owner(request).id);
		const body = objectBody(request.body);
		if (!Object.keys(body).some(key => mutableFields.has(key))) throw new ApiError(422, 'Supply at least one editable audio field.', 'ValidationError');
		const updated = validateMetadata(body, row);
		ensureUnique(updated);
		ctx.db.run('UPDATE audio SET title=?,slug=?,category=?,description=?,tags=?,license=?,visibility=?,is_downloadable=?,updated=? WHERE id=?',
			updated.title, updated.slug, updated.category, updated.description, updated.tags, updated.license, updated.visibility, updated.is_downloadable, now(), updated.id);
		return metadata(find(updated.id));
	});
	app.post('/v1/audio/delete', async (request, reply) => {
		const row = find(queryId(request), owner(request).id);
		await ctx.blobs.remove(row.blob_id);
		ctx.db.run('DELETE FROM audio WHERE id=?', row.id);
		return reply.code(204).send();
	});
}
