import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from './database.ts';

export interface Config {
	dataDir: string;
	publicUrl: string;
	host: string;
	port: number;
	registration: boolean;
	corsOrigins: string[];
	maxUploadBytes: number;
	maxUserBytes: number;
	uploadTtlSeconds: number;
	tokenTtlSeconds: number;
	adminEmail: string;
	adminPassword: string | undefined;
	audacityClientId: string;
	audacityClientSecret: string;
	logger: boolean;
}

export interface User {
	id: string;
	email: string;
	username: string;
	name: string;
	admin: boolean;
}

export interface UploadDescriptor {
	id: string;
	url: string;
	success: string;
	fail: string;
	progress?: string;
}

export interface BlobInfo {
	id: string;
	owner_id: string;
	kind: string;
	resource_id: string;
	state: 'pending' | 'uploaded' | 'ready' | 'failed';
	size: number;
	mime: string;
	sha256: string;
	path: string;
	expected_size: number | null;
	expires: number;
}

export interface UploadOptions {
	kind: string;
	resourceId: string;
	mime?: string;
	expectedSize?: number;
	maxBytes?: number;
	validate?: (path: string) => void | Promise<void>;
}

export interface BlobService {
	setValidator(kind: string, validate: (blob: BlobInfo, path: string) => void | Promise<void>): void;
	create(ownerId: string, options: UploadOptions): UploadDescriptor;
	renew(id: string): UploadDescriptor;
	get(id: string): BlobInfo | undefined;
	ready(id: string): BlobInfo | undefined;
	downloadUrl(id: string): string;
	remove(id: string): Promise<void>;
}

export interface AuthService {
	requireUser(request: FastifyRequest, scope?: 'audio' | 'projects'): User;
	findUser(id: string): User | undefined;
}

export interface Context {
	config: Config;
	db: Database;
	blobs: BlobService;
	auth: AuthService;
}

export type RegisterRoutes = (app: FastifyInstance, context: Context) => void | Promise<void>;

export class ApiError extends Error {
	readonly statusCode: number;
	readonly errorName: string;
	constructor(statusCode: number, message: string, errorName = 'Error') {
		super(message);
		this.statusCode = statusCode;
		this.errorName = errorName;
	}
}

export function objectBody(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ApiError(422, 'Expected a JSON object.', 'ValidationError');
	}
	return value as Record<string, unknown>;
}

export function requiredString(value: unknown, name: string, max = 256): string {
	if (typeof value !== 'string' || !value.trim() || value.length > max) {
		throw new ApiError(422, `${name} must be a nonempty string of at most ${max} characters.`, 'ValidationError');
	}
	return value.trim();
}

export function pageQuery(value: unknown): { page: number; perPage: number; search: string } {
	const query = objectBody(value);
	const page = Number(query.page ?? 1);
	const perPage = Number(query['per-page'] ?? query.per_page ?? 20);
	if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) {
		throw new ApiError(422, 'page must be positive and per-page must be between 1 and 100.', 'ValidationError');
	}
	return { page, perPage, search: typeof query.q === 'string' ? query.q.slice(0, 256) : '' };
}

export function pagination(total: number, page: number, perPage: number) {
	return { total, total_count: total, pages: Math.ceil(total / perPage), current: page, page, size: perPage, per_page: perPage };
}

export function now(): number {
	return Math.floor(Date.now() / 1000);
}
