import { ApiError, now } from './core.ts';
import type { Context } from './core.ts';
import { descriptor, getSnapshot, snapshotBlocks } from './projects-store.ts';
import type { BlockRow, ProjectRow, SnapshotRow } from './projects-store.ts';

export function snapshotInfo(ctx: Context, snapshot: SnapshotRow, expand = false) {
	const file = ctx.blobs.ready(snapshot.file_id);
	const blocks = snapshotBlocks(ctx, snapshot);
	return {
		id: snapshot.id, parent_id: snapshot.parent_id,
		date_created: snapshot.created, date_updated: snapshot.updated, date_synced: snapshot.synced,
		file_size: file?.size ?? 0,
		blocks_size: blocks.reduce((total, block) => total + (ctx.blobs.ready(block.blob_id)?.size ?? 0), 0),
		format: snapshot.format, transport: snapshot.format === 'audacity' ? 'blocks' : 'file',
		...(expand ? {
			file_url: file ? ctx.blobs.downloadUrl(file.id) : '',
			blocks: blocks.filter((block) => ctx.blobs.ready(block.blob_id)).map((block) => ({ hash: block.hash, url: ctx.blobs.downloadUrl(block.blob_id) })),
		} : {}),
	};
}

export function projectInfo(ctx: Context, project: ProjectRow) {
	const owner = ctx.auth.findUser(project.owner_id);
	const head = project.head_id ? getSnapshot(ctx, project, project.head_id) : undefined;
	const synced = project.synced_id ? getSnapshot(ctx, project, project.synced_id) : undefined;
	const info = synced ? snapshotInfo(ctx, synced) : undefined;
	return {
		id: project.id, username: owner?.username ?? '', author_name: owner?.name ?? '',
		slug: project.slug, name: project.name, details: project.details,
		date_created: project.created, date_updated: project.updated,
		size: info ? info.file_size + info.blocks_size : 0,
		head: head ? snapshotInfo(ctx, head) : null,
		latest_synced_snapshot_id: project.synced_id,
		format: head?.format ?? 'audacity', transport: head?.format === 'audacity' ? 'blocks' : 'file',
	};
}

function sameUploadOrigin(ctx: Context, upload: string): boolean {
	try { return new URL(descriptor(upload).url).origin === new URL(ctx.config.publicUrl).origin; }
	catch { return false; }
}

function replaceFailedBlock(ctx: Context, block: BlockRow): BlockRow {
	const blob = ctx.blobs.get(block.blob_id);
	if (blob && (blob.state === 'ready' || (blob.state !== 'failed' && blob.expires > now())) && sameUploadOrigin(ctx, block.upload)) return block;
	const upload = blob && blob.state !== 'failed' ? ctx.blobs.renew(blob.id) : ctx.blobs.create(block.owner_id, { kind: 'project-block', resourceId: block.hash, mime: 'application/octet-stream', maxBytes: 64 * 1024 * 1024 });
	const row = { ...block, blob_id: upload.id, upload: JSON.stringify(upload) };
	ctx.db.run('UPDATE project_blocks SET blob_id=?,upload=? WHERE owner_id=? AND hash=?', row.blob_id, row.upload, row.owner_id, row.hash);
	return row;
}

export function syncState(ctx: Context, project: ProjectRow, snapshot: SnapshotRow, renew = false) {
	if (renew) {
		for (const field of ['file', 'mixdown'] as const) {
			const id = snapshot[`${field}_id`]; const old = ctx.blobs.get(id);
			if (old && (old.state === 'ready' || (old.state !== 'failed' && old.expires > now())) && sameUploadOrigin(ctx, snapshot[`${field}_upload`])) continue;
			const upload = old && old.state !== 'failed' ? ctx.blobs.renew(old.id) : ctx.blobs.create(project.owner_id, {
				kind: field === 'file' ? snapshot.format === 'audacity' ? 'project-file' : 'project-archive' : 'project-mixdown',
				resourceId: snapshot.id, mime: old?.mime ?? 'application/octet-stream',
				...(old?.expected_size == null ? {} : { expectedSize: old.expected_size }),
				maxBytes: field === 'file' && snapshot.format === 'audacity' ? 256 * 1024 * 1024 : ctx.config.maxUploadBytes,
			});
			ctx.db.run(`UPDATE snapshots SET ${field}_id=?,${field}_upload=? WHERE id=?`, upload.id, JSON.stringify(upload), snapshot.id);
			snapshot[`${field}_id`] = upload.id; snapshot[`${field}_upload`] = JSON.stringify(upload);
		}
	}
	const missing = snapshotBlocks(ctx, snapshot).filter((block) => !ctx.blobs.ready(block.blob_id));
	return {
		file: renew && ctx.blobs.ready(snapshot.file_id) ? { id: snapshot.file_id, url: '', success: '', fail: '' } : descriptor(snapshot.file_upload),
		mixdown: renew && ctx.blobs.ready(snapshot.mixdown_id) ? { id: snapshot.mixdown_id, url: '', success: '', fail: '' } : descriptor(snapshot.mixdown_upload),
		blocks: missing.map((block) => {
			const current = renew ? replaceFailedBlock(ctx, block) : block;
			return { ...descriptor(current.upload), id: current.hash };
		}),
	};
}

export function completeSnapshot(ctx: Context, project: ProjectRow, snapshot: SnapshotRow) {
	if (snapshot.synced) return snapshotInfo(ctx, snapshot, true);
	if (project.head_id !== snapshot.id) throw new ApiError(409, 'A newer project head exists. This snapshot cannot replace it.', 'ProjectVersionConflict');
	if (!ctx.blobs.ready(snapshot.file_id) || snapshotBlocks(ctx, snapshot).some((block) => !ctx.blobs.ready(block.blob_id))) throw new ApiError(409, 'Upload and confirm the project file and every missing block before completing synchronization.', 'UploadIncomplete');
	const date = now();
	ctx.db.transaction(() => {
		ctx.db.run('UPDATE snapshots SET synced=?,updated=? WHERE id=?', date, date, snapshot.id);
		ctx.db.run('UPDATE projects SET synced_id=?,updated=? WHERE id=? AND head_id=?', snapshot.id, date, project.id, snapshot.id);
	});
	return snapshotInfo(ctx, { ...snapshot, synced: date, updated: date }, true);
}
