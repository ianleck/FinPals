import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleBalance } from '../../commands/balance';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('handleBalance command', () => {
	let db: D1Database;
	let mockPreparedStatement: any;

	beforeEach(() => {
		db = createMockDB();
		mockPreparedStatement = (db as any)._getMockStatement();
		vi.clearAllMocks();
	});

	describe('Group balances', () => {
		it('should show balanced group', async () => {
			const ctx = createMockContext();

			mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

			await handleBalance(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('✨ <b>All Settled Up!</b>'),
				expect.any(Object)
			);
		});

		it('should show outstanding balances', async () => {
			const ctx = createMockContext();

			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [
					{
						user1: '123456789',
						user2: '987654321',
						net_amount: 25.50,
						user1_username: 'testuser',
						user2_username: 'john',
					},
				],
			});

			await handleBalance(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('@john owes @testuser: <b>$25.50</b>'),
				expect.any(Object)
			);
		});

		it('should handle trip-specific balances', async () => {
			const ctx = createMockContext();
			const tripId = 'trip-123';

			mockPreparedStatement.first.mockResolvedValueOnce({
				id: tripId,
				name: 'Weekend Trip',
			});
			mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

			await handleBalance(ctx, db, tripId);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('No outstanding balances for trip "Weekend Trip"'),
				expect.any(Object)
			);
		});
	});

	describe('Personal balances', () => {
		it('should show personal expense summary', async () => {
			const ctx = createPrivateContext();

			mockPreparedStatement.first.mockResolvedValueOnce({
				total_spent: 500.00,
				expense_count: 10,
				last_expense: '2024-01-01',
			});

			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [
					{ category: 'Food & Dining', total: 300, count: 6 },
					{ category: 'Transportation', total: 200, count: 4 },
				],
			});

			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [
					{ month: '2024-01', total: 500 },
				],
			});

			await handleBalance(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('💰 <b>Personal Expense Balance</b>'),
				expect.any(Object)
			);
			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('💸 <b>Total Spent:</b> $500.00'),
				expect.any(Object)
			);
		});

		it('should handle no personal expenses', async () => {
			const ctx = createPrivateContext();

			mockPreparedStatement.first.mockResolvedValueOnce(null);

			await handleBalance(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('🆕 No personal expenses tracked yet!'),
				expect.any(Object)
			);
		});
	});

	describe('Error handling', () => {
		it('should handle database errors', async () => {
			const ctx = createMockContext();

			mockPreparedStatement.all.mockRejectedValueOnce(new Error('DB Error'));

			await handleBalance(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('❌ Error calculating balances'),
				expect.any(Object)
			);
		});
	});
});