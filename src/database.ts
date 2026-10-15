import { DatabaseSync } from 'node:sqlite';
import type { SQLInputValue } from 'node:sqlite';

export class Database {
	private readonly connection: DatabaseSync;
	constructor(path: string) {
		this.connection = new DatabaseSync(path);
		this.connection.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
	}
	exec(sql: string): void { this.connection.exec(sql); }
	get<T>(sql: string, ...values: SQLInputValue[]): T | undefined {
		return this.connection.prepare(sql).get(...values) as T | undefined;
	}
	all<T>(sql: string, ...values: SQLInputValue[]): T[] {
		return this.connection.prepare(sql).all(...values) as T[];
	}
	run(sql: string, ...values: SQLInputValue[]) {
		return this.connection.prepare(sql).run(...values);
	}
	transaction<T>(operation: () => T): T {
		this.connection.exec('BEGIN IMMEDIATE');
		try {
			const result = operation();
			this.connection.exec('COMMIT');
			return result;
		} catch (error) {
			this.connection.exec('ROLLBACK');
			throw error;
		}
	}
	close(): void { this.connection.close(); }
}
