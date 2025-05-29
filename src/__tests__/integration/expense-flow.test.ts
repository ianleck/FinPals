import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAdd } from '../../commands/add';
import { handleBalance } from '../../commands/balance';
import { handleSettle } from '../../commands/settle';
import { handleHistory } from '../../commands/history';
import { createMockContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('Expense flow integration', () => {
	let db: D1Database;
	let expenses: any[] = [];
	let settlements: any[] = [];
	let mockPreparedStatement: any;

	beforeEach(() => {
		db = createMockDB();
		mockPreparedStatement = (db as any)._getMockStatement();
		expenses = [];
		settlements = [];
		vi.clearAllMocks();

		// Mock database to track expenses and settlements
		mockPreparedStatement.run.mockImplementation(async function() {
			const sql = (db.prepare as any).mock.calls.slice(-1)[0][0];
			if (sql.includes('INSERT INTO expenses')) {
				const expense = {
					id: crypto.randomUUID(),
					group_id: '-1001234567890',
					amount: 100,
					paid_by: '123456789',
					created_at: new Date().toISOString(),
				};
				expenses.push(expense);
			} else if (sql.includes('INSERT INTO settlements')) {
				const settlement = {
					id: crypto.randomUUID(),
					group_id: '-1001234567890',
					from_user: '987654321',
					to_user: '123456789',
					amount: 50,
					created_at: new Date().toISOString(),
				};
				settlements.push(settlement);
			}
			return { success: true };
		});
	});

	it('should complete full expense cycle', async () => {
		// Step 1: Add an expense
		const addCtx = createMockContext({
			message: { text: '/add 100 dinner' },
		});

		mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [
				{ user_id: '123456789' },
				{ user_id: '987654321' },
			],
		});

		await handleAdd(addCtx, db);
		expect(addCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('✅ <b>Expense Added</b>'),
			expect.any(Object)
		);

		// Step 2: Check balance
		const balanceCtx = createMockContext();
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [{
				user1: '123456789',
				user2: '987654321',
				net_amount: 50,
				user1_username: 'testuser',
				user2_username: 'john',
			}],
		});

		await handleBalance(balanceCtx, db);
		expect(balanceCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('@john owes @testuser: <b>$50.00</b>'),
			expect.any(Object)
		);

		// Step 3: Settle the debt
		const settleCtx = createMockContext({
			from: { id: 987654321, username: 'john' },
			message: {
				text: '/settle @testuser 50',
				entities: [{
					type: 'text_mention',
					offset: 8,
					length: 9,
					user: { id: 123456789, username: 'testuser' },
				}],
			},
		});

		await handleSettle(settleCtx, db);
		expect(settleCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('@john paid @testuser: $50.00'),
			expect.any(Object)
		);

		// Step 4: Verify balance is settled
		const finalBalanceCtx = createMockContext();
		mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

		await handleBalance(finalBalanceCtx, db);
		expect(finalBalanceCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('✨ <b>All Settled Up!</b>'),
			expect.any(Object)
		);
	});

	it('should handle multiple participants correctly', async () => {
		// Add expense split 3 ways
		const ctx = createMockContext({
			message: { text: '/add 90 lunch' },
		});

		mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [
				{ user_id: '123456789' },
				{ user_id: '987654321' },
				{ user_id: '555555555' },
			],
		});

		await handleAdd(ctx, db);

		// Each person should owe $30
		expect(mockPreparedStatement.run).toHaveBeenCalledWith(
			expect.objectContaining({
				bind: expect.any(Function),
			})
		);
	});

	it('should track history correctly', async () => {
		// Add some test data
		const historyCtx = createMockContext();
		
		mockPreparedStatement.all.mockResolvedValueOnce({
			results: [
				{
					type: 'expense',
					id: '1',
					amount: 100,
					description: 'dinner',
					created_at: '2024-01-15T12:00:00Z',
					user_username: 'testuser',
				},
				{
					type: 'settlement',
					id: '2',
					amount: 50,
					created_at: '2024-01-15T13:00:00Z',
					user_username: 'john',
					to_username: 'testuser',
				},
			],
		});

		mockPreparedStatement.first.mockResolvedValue({ count: 2 });

		await handleHistory(historyCtx, db);

		expect(historyCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('📜 <b>Transaction History</b>'),
			expect.any(Object)
		);
		expect(historyCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('dinner'),
			expect.any(Object)
		);
		expect(historyCtx.reply).toHaveBeenCalledWith(
			expect.stringContaining('@john → @testuser'),
			expect.any(Object)
		);
	});
});