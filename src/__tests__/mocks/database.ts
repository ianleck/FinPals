import { vi } from 'vitest';

export function createMockDB(): D1Database {
	const results = new Map<string, any>();
	
	const mockPreparedStatement = {
		bind: vi.fn().mockReturnThis(),
		first: vi.fn().mockImplementation(async () => {
			const key = JSON.stringify(Array.from(arguments));
			return results.get(key) || null;
		}),
		all: vi.fn().mockImplementation(async () => {
			const key = JSON.stringify(Array.from(arguments));
			return { results: results.get(key) || [] };
		}),
		run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
	};

	const mockDB = {
		prepare: vi.fn().mockReturnValue(mockPreparedStatement),
		batch: vi.fn().mockResolvedValue([]),
		exec: vi.fn().mockResolvedValue({ count: 0 }),
		_setMockData: (key: string, data: any) => {
			results.set(key, data);
		},
		_getMockStatement: () => mockPreparedStatement,
	};

	return mockDB as unknown as D1Database;
}

export function setupTestDatabase(): D1Database {
	const db = createMockDB();
	
	// Add some default test data
	const testUsers = [
		{ telegram_id: '123456789', username: 'testuser', first_name: 'Test' },
		{ telegram_id: '987654321', username: 'john', first_name: 'John' },
		{ telegram_id: '555555555', username: 'sarah', first_name: 'Sarah' },
	];
	
	const testGroups = [
		{ telegram_id: '-1001234567890', title: 'Test Group' },
	];
	
	const testGroupMembers = [
		{ group_id: '-1001234567890', user_id: '123456789', active: true },
		{ group_id: '-1001234567890', user_id: '987654321', active: true },
		{ group_id: '-1001234567890', user_id: '555555555', active: true },
	];
	
	return db;
}