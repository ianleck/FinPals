export function createMockDB(): D1Database {
	const results = new Map<string, any>();
	
	const mockPreparedStatement = {
		bind: jest.fn().mockReturnThis(),
		first: jest.fn().mockImplementation(async () => {
			const key = JSON.stringify(Array.from(arguments));
			return results.get(key) || null;
		}),
		all: jest.fn().mockImplementation(async () => {
			const key = JSON.stringify(Array.from(arguments));
			return { results: results.get(key) || [] };
		}),
		run: jest.fn().mockResolvedValue({ success: true }),
	};

	const mockDB = {
		prepare: jest.fn().mockReturnValue(mockPreparedStatement),
		batch: jest.fn().mockResolvedValue([]),
		exec: jest.fn().mockResolvedValue({ count: 0 }),
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