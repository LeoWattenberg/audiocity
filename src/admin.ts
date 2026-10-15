import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Authentication } from './auth.ts';
import { readConfig } from './config.ts';
import { Database } from './database.ts';

process.umask(0o077);
const config = readConfig();
const action = process.argv[2];
const email = process.argv[3];
const password = process.env.AUDIOCITY_NEW_PASSWORD;
if (!['create-user', 'reset-password'].includes(action ?? '') || !email || !password) {
	throw new Error('Usage: AUDIOCITY_NEW_PASSWORD=… node dist/admin.js <create-user|reset-password> <email>. Stop the server first.');
}
await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
const db = new Database(join(config.dataDir, 'audiocity.sqlite'));
try {
	if (!db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")) throw new Error('Start Audiocity once to initialize this data directory.');
	const auth = new Authentication(config, db);
	if (action === 'create-user') await auth.createUser({ email, password });
	else await auth.resetPassword(email, password);
	process.stdout.write(`${action} completed for ${email}.\n`);
} finally { db.close(); }
