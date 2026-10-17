import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { inspectAudioHeader } from './audio-formats.ts';
import { audioSlug } from './audio-metadata.ts';
import type { AudioRecord } from './audio-metadata.ts';
import { ApiError, now } from './core.ts';
import type { Config } from './core.ts';
import type { Database } from './database.ts';

export class SharedLibrary {
	private key = Buffer.alloc(0);
	private lastScan = 0;
	private scanning: Promise<number> | undefined;
	private root = '';
	private readonly db: Database;
	private readonly config: Config;
	constructor(db: Database, config: Config) { this.db = db; this.config = config; }
	async initialize(): Promise<void> {
		this.key = Buffer.from(await readFile(join(this.config.dataDir, 'signing.key')));
		if (this.config.sharedDir) {
			this.root = resolve(this.config.sharedDir);
			if ((await lstat(this.root)).isSymbolicLink() || await realpath(this.root) !== this.root || !(await lstat(this.root)).isDirectory()) {
				throw new Error('AUDIOCITY_SHARED_DIR must be an existing directory without symlink components.');
			}
		}
		await this.scan(true);
	}
	async scan(force = false): Promise<number> {
		if (this.scanning) return this.scanning;
		if (!force && Date.now() - this.lastScan < 30_000) return this.db.get<{ count: number }>("SELECT count(*) count FROM audio WHERE origin='shared-folder' AND shared_present=1")?.count ?? 0;
		this.scanning = this.scanFiles();
		try { const count = await this.scanning; this.lastScan = Date.now(); return count; }
		finally { this.scanning = undefined; }
	}
	private async verifiedFile(path: string): Promise<FileHandle> {
		if (!this.root || !path || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.' || !part)) throw new ApiError(404, 'Shared file not found.', 'NotFound');
		const full = resolve(this.root, path);
		if (!full.startsWith(this.root + sep)) throw new ApiError(404, 'Shared file not found.', 'NotFound');
		// Reject links in every component before opening; verify again after opening.
		let component = this.root;
		for (const segment of path.split(sep)) {
			component = join(component, segment);
			if ((await lstat(component)).isSymbolicLink()) throw new ApiError(404, 'Shared file not found.', 'NotFound');
		}
		const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const actual = process.platform === 'linux' ? await realpath(`/proc/self/fd/${file.fd}`) : await realpath(full);
			if (actual !== full || !(await file.stat()).isFile()) throw new ApiError(404, 'Shared file not found.', 'NotFound');
			return file;
		} catch (error) { await file.close(); throw error; }
	}
	private async scanFiles(): Promise<number> {
		const seen: string[] = [];
		if (this.root) {
			const walk = async (directory: string): Promise<void> => {
				try {
					// A root or subdirectory replaced with a symlink is never traversed.
					if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) return;
					for (const entry of await readdir(directory, { withFileTypes: true })) {
						if (entry.isSymbolicLink()) continue;
						const full = join(directory, entry.name);
						if (entry.isDirectory()) { await walk(full); continue; }
						if (!entry.isFile() || !/\.(?:wav|wave|mp3|flac|wv|aif|aiff|aifc|ogg|oga|opus|m4a|mp4|aac|webm|weba)$/i.test(entry.name)) continue;
						const path = relative(this.root, full);
						let file: FileHandle | undefined;
						try {
							file = await this.verifiedFile(path);
							const stat = await file.stat();
							const header = Buffer.alloc(65_536);
							const { bytesRead } = await file.read(header, 0, header.length, 0);
							const { mime, duration } = inspectAudioHeader(header.subarray(0, bytesRead));
							const id = `shared-${createHash('sha256').update(path).digest('hex').slice(0, 32)}`;
							const existing = this.db.get<AudioRecord>('SELECT * FROM audio WHERE id=?', id);
							if (!existing) {
								const name = basename(path).slice(0, 256); const title = name.replace(/\.[^.]{1,8}$/, '') || name;
								const base = audioSlug(title); let slug = base;
								for (let n = 2; this.db.get("SELECT id FROM audio WHERE owner_id='__shared__' AND slug=?", slug); n++) slug = `${base.slice(0, 90)}-${n}`;
								this.db.run(`INSERT INTO audio(id,owner_id,blob_id,name,title,slug,category,description,tags,license,visibility,is_downloadable,duration,created,updated,origin,shared_path,shared_size,shared_mtime,shared_mime,shared_present)
									VALUES (?,'__shared__','',?,?,?,'other','','[]','arr','shared',1,?,?,?,'shared-folder',?,?,?,?,1)`, id, name, title, slug, duration, Math.floor(stat.birthtimeMs / 1000) || now(), now(), path, stat.size, stat.mtimeMs, mime);
							} else this.db.run('UPDATE audio SET shared_path=?,shared_size=?,shared_mtime=?,shared_mime=?,duration=?,shared_present=1 WHERE id=?', path, stat.size, stat.mtimeMs, mime, duration, id);
							seen.push(id);
						} catch (error) {
							// Unsupported containers, broken links, and unreadable files stay out of the index.
							if (!(error instanceof ApiError) && !['ENOENT', 'EACCES', 'EPERM', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
						} finally { await file?.close(); }
					}
				} catch (error) {
					if (!['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
				}
			};
			await walk(this.root);
		}
		const present = new Set(seen);
		for (const row of this.db.all<{ id: string }>("SELECT id FROM audio WHERE origin='shared-folder' AND shared_present=1")) {
			if (!present.has(row.id)) this.db.run('UPDATE audio SET shared_present=0 WHERE id=?', row.id);
		}
		return seen.length;
	}
	private sign(row: AudioRecord, expires: number): string {
		return createHmac('sha256', this.key).update(`shared:${row.id}:${row.shared_size}:${row.shared_mtime}:${expires}`).digest('base64url');
	}
	downloadUrl(row: AudioRecord): string {
		const expires = now() + 3600;
		return `${this.config.publicUrl}/shared-media/${row.id}?expires=${expires}&signature=${this.sign(row, expires)}`;
	}
	async send(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
		const { id } = request.params as { id: string };
		const query = request.query as { expires?: string; signature?: string };
		const expires = Number(query.expires);
		const row = this.db.get<AudioRecord>("SELECT * FROM audio WHERE id=? AND origin='shared-folder' AND shared_present=1", id);
		if (!row) throw new ApiError(404, 'Shared file not found.', 'NotFound');
		const expected = this.sign(row, expires); const supplied = query.signature;
		if (!Number.isSafeInteger(expires) || expires < now() || expires > now() + 3660 || typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
			|| !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new ApiError(403, 'Invalid or expired download capability.');
		let file: FileHandle;
		try { file = await this.verifiedFile(row.shared_path); }
		catch { throw new ApiError(404, 'Shared file not found.', 'NotFound'); }
		try {
			const stat = await file.stat();
			if (stat.size !== row.shared_size || stat.mtimeMs !== row.shared_mtime) throw new ApiError(409, 'The shared file has changed. Refresh the library.', 'Conflict');
			let start = 0; let end = stat.size - 1;
			reply.header('accept-ranges', 'bytes').header('content-type', row.shared_mime).header('x-content-type-options', 'nosniff').header('cache-control', 'private, max-age=60');
			if (request.headers.range) {
				const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
				if (!match || (!match[1] && !match[2])) { await file.close(); return reply.code(416).header('content-range', `bytes */${stat.size}`).send(); }
				if (!match[1]) start = Math.max(0, stat.size - Number(match[2]));
				else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
				if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size || (!match[1] && Number(match[2]) === 0)) {
					await file.close(); return reply.code(416).header('content-range', `bytes */${stat.size}`).send();
				}
				reply.code(206).header('content-range', `bytes ${start}-${end}/${stat.size}`);
			}
			reply.header('content-length', end - start + 1);
			if (request.method === 'HEAD') { await file.close(); return reply.send(); }
			return reply.send(file.createReadStream({ start, end, autoClose: true }));
		} catch (error) { await file.close(); throw error; }
	}
}
