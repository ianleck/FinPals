import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAdd } from '../../commands/add';
import { handleBalance } from '../../commands/balance';
import { handleSettle } from '../../commands/settle';
import { handleHistory } from '../../commands/history';
import { createMockContext } from '../mocks/context';
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';

describe('Expense flow integration', () => {
	let db: D1Database;
	let expenses: any[] = [];
	let settlements: any[] = [];

	beforeEach(() => {
		db = createTestDatabase();
		expenses = [];
		settlements = [];
		vi.clearAllMocks();

		// Mock database to track expenses and settlements
		const mockStmt = (db as any)._getMockStatement();
		mockStmt.run.mockImplementation(async function() {
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

		const mockStmt = (db as any)._getMockStatement();
		// Mock group exists
		mockStmt.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
		// Mock database runs
		mockStmt.run.mockResolvedValue({ meta: { changes: 1 } });
		// Mock group members
		mockStmt.all.mockResolvedValueOnce({
			results: [
				{ user_id: '123456789' },
				{ user_id: '987654321' },
			],
		});
		// Mock no category mapping
		mockStmt.first.mockResolvedValueOnce(null);
		// Mock participants for display
		mockStmt.all.mockResolvedValueOnce({
			results: [
				{ telegram_id: '123456789', username: 'testuser', first_name: 'Test' },
				{ telegram_id: '987654321', username: 'john', first_name: 'John' },
			],
		});

		await handleAdd(addCtx, db);
		const { text: addText } = extractReplyContent(addCtx);
		expect(addText.toLowerCase()).toContain('expense');
		expect(addText).toContain('100');
		expect(addText).toContain('dinner');

		// Step 2: Check balance
		const balanceCtx = createMockContext();
		mockStmt.all.mockResolvedValueOnce({
			results: [{
				user1: '123456789',
				user2: '987654321',
				net_amount: 50,
				user1_username: 'testuser',
				user2_username: 'john',
			}],
		});

		await handleBalance(balanceCtx, db);
		const { text: balanceText } = extractReplyContent(balanceCtx);
		expect(balanceText).toContain('john');
		expect(balanceText).toContain('testuser');
		expect(balanceText).toContain('50');

		// Step 3: Settle the debt
		const settleCtx = createMockContext({
			from: { id: 987654321, username: 'john' },
			message: {
				text: '/settle @testuser 50',
				entities: [{
					type: 'text_mention',
					offset: 8,
					length: 9,
					user: { id: 123456789, username: 'testuser', is_bot: false, first_name: 'Test' },
				}],
			},
		});

		// Mock for settle command
		mockStmt.first.mockResolvedValueOnce({ telegram_id: '123456789', username: 'testuser' }); // Find user
		mockStmt.first.mockResolvedValueOnce({ net_balance: -50 }); // Current balance

		await handleSettle(settleCtx, db);
		const { text: settleText } = extractReplyContent(settleCtx);
		expect(settleText).toContain('john');
		expect(settleText).toContain('testuser');
		expect(settleText).toContain('50');

		// Step 4: Verify balance is settled
		const finalBalanceCtx = createMockContext();
		mockStmt.all.mockResolvedValueOnce({ results: [] });

		await handleBalance(finalBalanceCtx, db);
		const { text: finalText } = extractReplyContent(finalBalanceCtx);
		expect(finalText.toLowerCase()).toMatch(/settled|all clear|no.*balance/);
	});

	it('should handle multiple participants correctly', async () => {
		// Add expense split 3 ways
		const ctx = createMockContext({
			message: { text: '/add 90 lunch' },
		});

		const mockStmt = (db as any)._getMockStatement();
		mockStmt.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
		mockStmt.all.mockResolvedValueOnce({
			results: [
				{ user_id: '123456789' },
				{ user_id: '987654321' },
				{ user_id: '555555555' },
			],
		});

		await handleAdd(ctx, db);

		// Verify expense was added
		expect(ctx.reply).toHaveBeenCalled();
		const { text } = extractReplyContent(ctx);
		expect(text).toContain('90');
		expect(text).toContain('lunch');
	});

	it('should track history correctly', async () => {
		// Add some test data
		const historyCtx = createMockContext();
		
		const mockStmt = (db as any)._getMockStatement();
		mockStmt.all.mockResolvedValueOnce({
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

		mockStmt.first.mockResolvedValue({ count: 2 });

		await handleHistory(historyCtx, db);

		const { text } = extractReplyContent(historyCtx);
		expect(text.toLowerCase()).toContain('recent transactions');
		expect(text).toContain('dinner');
		expect(text).toContain('testuser');
		// The settlement shows as @john → @testuser
		expect(text).toContain('→');
	});
});