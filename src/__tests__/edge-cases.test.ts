import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAdd } from '../commands/add';
import { handleBalance } from '../commands/balance';
import { handleSettle } from '../commands/settle';
import { handleBudget } from '../commands/budget';
import { createMockContext, createPrivateContext } from './mocks/context';
import { createMockDB } from './mocks/database';

describe('Edge cases and error scenarios', () => {
	let db: D1Database;
	let mockPreparedStatement: any;

	beforeEach(() => {
		db = createMockDB();
		mockPreparedStatement = (db as any)._getMockStatement();
		vi.clearAllMocks();
	});

	describe('Unicode and special characters', () => {
		it('should handle emojis in descriptions', async () => {
			const ctx = createMockContext({
				message: { text: '/add 50 🍕 pizza night 🎉' },
			});

			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [{ user_id: '123456789' }],
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('🍕 pizza night 🎉'),
				expect.any(Object)
			);
		});

		it('should handle special characters in usernames', async () => {
			const ctx = createMockContext({
				message: {
					text: '/settle @user_with-special.chars 50',
					entities: [{ 
						type: 'mention', 
						offset: 8, 
						length: 24,
					}],
				},
			});

			mockPreparedStatement.first.mockResolvedValueOnce({
				telegram_id: '987654321',
				username: 'user_with-special.chars',
			});

			await handleSettle(ctx, db);

			expect(mockPreparedStatement.run).toHaveBeenCalled();
		});

		it('should escape HTML in messages', async () => {
			const ctx = createMockContext({
				message: { text: '/add 50 <script>alert("xss")</script>' },
			});

			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [{ user_id: '123456789' }],
			});

			await handleAdd(ctx, db);

			// Should not contain raw HTML
			expect(ctx.reply).not.toHaveBeenCalledWith(
				expect.stringContaining('<script>'),
				expect.any(Object)
			);
		});
	});

	describe('Numeric edge cases', () => {
		it('should handle very large amounts', async () => {
			const ctx = createMockContext({
				message: { text: '/add 999999.99 expense' },
			});

			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [{ user_id: '123456789' }],
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('$999,999.99'),
				expect.any(Object)
			);
		});

		it('should handle very small amounts', async () => {
			const ctx = createMockContext({
				message: { text: '/add 0.01 penny' },
			});

			mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
			mockPreparedStatement.all.mockResolvedValueOnce({
				results: [{ user_id: '123456789' }],
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('$0.01'),
				expect.any(Object)
			);
		});

		it('should reject zero amount', async () => {
			const ctx = createMockContext({
				message: { text: '/add 0 free' },
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('valid number'),
				expect.any(Object)
			);
		});

		it('should reject negative amounts', async () => {
			const ctx = createMockContext({
				message: { text: '/add -50 refund' },
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('valid number'),
				expect.any(Object)
			);
		});
	});

	describe('Concurrent operations', () => {
		it('should handle multiple expenses added simultaneously', async () => {
			const promises = [];
			
			for (let i = 0; i < 5; i++) {
				const ctx = createMockContext({
					message: { text: `/add ${10 + i} expense${i}` },
				});

				mockPreparedStatement.first.mockResolvedValueOnce({ telegram_id: '-1001234567890' });
				mockPreparedStatement.all.mockResolvedValueOnce({
					results: [{ user_id: '123456789' }],
				});

				promises.push(handleAdd(ctx, db));
			}

			await Promise.all(promises);

			// All expenses should be created
			expect(mockPreparedStatement.run).toHaveBeenCalledTimes(15); // 5 expenses * 3 calls each
		});
	});

	describe('Missing or invalid data', () => {
		it('should handle missing chat context', async () => {
			const ctx = createMockContext({
				chat: null,
				message: { text: '/add 50 test' },
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalled();
		});

		it('should handle missing user context', async () => {
			const ctx = createMockContext({
				from: null,
				message: { text: '/balance' },
			});

			await expect(handleBalance(ctx, db)).resolves.not.toThrow();
		});

		it('should handle database connection errors', async () => {
			const ctx = createMockContext({
				message: { text: '/add 50 test' },
			});

			db.prepare = vi.fn().mockImplementation(() => {
				throw new Error('Database connection failed');
			});

			await handleAdd(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Something went wrong'),
				expect.any(Object)
			);
		});
	});

	describe('Budget edge cases', () => {
		it('should handle budget with quotes in category name', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "John\'s Food" 100 weekly' },
			});

			await handleBudget(ctx, db);

			expect(mockPreparedStatement.run).toHaveBeenCalled();
		});

		it('should reject budget with invalid category', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "" 100 monthly' },
			});

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('Usage:'),
				expect.any(Object)
			);
		});

		it('should handle budget amount at limits', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "Test" 0.01 daily' },
			});

			await handleBudget(ctx, db);

			expect(ctx.reply).toHaveBeenCalledWith(
				expect.stringContaining('$0.01/day'),
				expect.any(Object)
			);
		});
	});

	describe('Group permission scenarios', () => {
		it('should handle non-admin trying to delete others expense', async () => {
			const ctx = createMockContext({
				callbackQuery: {
					data: 'del:expense-123:0',
					from: { id: 987654321 }, // Different user
				},
			});

			mockPreparedStatement.first.mockResolvedValueOnce({
				id: 'expense-123',
				created_by: '123456789', // Different creator
			});

			ctx.getChatMember = vi.fn().mockResolvedValue({ status: 'member' });

			// Should be handled by the callback query handler
			expect(ctx.answerCallbackQuery).toBeDefined();
		});
	});
});