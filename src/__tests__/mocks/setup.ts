import { vi } from 'vitest';
import type { Context } from 'grammy';
import type { Database } from '../../db';
import type { Env } from '../../index';

/**
 * Create a mock Telegram context
 */
export function createMockContext(overrides: any = {}): Context {
	return {
		message: {
			text: '/test',
			message_id: 1,
			date: Date.now(),
			chat: {
				id: -1001234567890,
				type: 'group',
				title: 'Test Group',
			},
			from: {
				id: 123456789,
				is_bot: false,
				first_name: 'Test',
				username: 'testuser',
			},
			...overrides.message,
		},
		chat: overrides.chat || {
			id: -1001234567890,
			type: 'group',
			title: 'Test Group',
		},
		from: overrides.from || {
			id: 123456789,
			is_bot: false,
			first_name: 'Test',
			username: 'testuser',
		},
		reply: vi.fn(),
		answerCallbackQuery: vi.fn(),
		editMessageText: vi.fn(),
		deleteMessage: vi.fn(),
		api: {
			sendMessage: vi.fn(),
			deleteMessage: vi.fn(),
		},
		...overrides,
	} as any;
}

/**
 * Create a mock database
 */
export function createMockDatabase(): Database {
	const chainableMock = {
		select: vi.fn(() => chainableMock),
		from: vi.fn(() => chainableMock),
		where: vi.fn(() => chainableMock),
		innerJoin: vi.fn(() => chainableMock),
		leftJoin: vi.fn(() => chainableMock),
		orderBy: vi.fn(() => chainableMock),
		limit: vi.fn(() => chainableMock),
		groupBy: vi.fn(() => chainableMock),
		then: vi.fn((resolve) => Promise.resolve([]).then(resolve)),
	};

	return {
		select: vi.fn(() => chainableMock),
		insert: vi.fn(() => ({
			values: vi.fn(() => ({
				returning: vi.fn(() => Promise.resolve([{ id: 'test-id' }])),
			})),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(() => Promise.resolve([])),
				})),
			})),
		})),
		delete: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(() => Promise.resolve([])),
			})),
		})),
		transaction: vi.fn(async (fn) => {
			const txMock = createMockDatabase();
			return await fn(txMock);
		}),
		execute: vi.fn(() => Promise.resolve({ rows: [] })),
		$client: {
			unsafe: vi.fn(() => Promise.resolve({ rows: [] })),
		},
	} as any;
}

/**
 * Create a mock environment
 */
export function createMockEnv(): Env {
	return {
		BOT_TOKEN: 'test-token',
		TELEGRAM_BOT_API_SECRET_TOKEN: 'test-secret',
		ENV: 'test',
		HYPERDRIVE: {
			connectionString: 'postgresql://test@localhost/test',
		},
		SESSIONS: {
			get: vi.fn(),
			put: vi.fn(),
			delete: vi.fn(),
			list: vi.fn(),
		},
	} as any;
}

/**
 * Setup a context with env for command tests
 */
export function setupCommandTest(overrides: any = {}) {
	const ctx = createMockContext(overrides);
	const env = createMockEnv();

	return { ctx, env };
}
