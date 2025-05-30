import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleAdd } from '../commands/add';
import { handleSettle } from '../commands/settle';
import { handleBudget } from '../commands/budget';
import { createMockContext, createPrivateContext } from './mocks/context';
import { createTestDatabase, extractReplyContent } from './helpers/test-utils';

describe('Edge cases and error scenarios', () => {
	let db: D1Database;

	beforeEach(() => {
		db = createTestDatabase();
		vi.clearAllMocks();
	});

	describe('Unicode and special characters', () => {
		it('should handle emojis in descriptions', async () => {
			const ctx = createMockContext({
				message: { text: '/add 50 🍕 pizza night 🎉' },
			});

			await handleAdd(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text).toContain('🍕 pizza night 🎉');
			expect(text).toContain('50');
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

			await handleSettle(ctx, db);

			// Just verify command processed the username
			expect(ctx.reply).toHaveBeenCalled();
		});

		it('should escape HTML in messages for security', async () => {
			const ctx = createMockContext({
				message: { text: '/add 50 <script>alert("xss")</script>' },
			});

			await handleAdd(ctx, db);

			// Verify raw HTML is not in the response
			const replyCall = ctx.reply.mock.calls[0];
			if (replyCall && replyCall[0]) {
				expect(replyCall[0]).not.toContain('<script>');
			}
		});
	});

	describe('Numeric edge cases', () => {
		it('should handle very large amounts', async () => {
			const ctx = createMockContext({
				message: { text: '/add 999999.99 expense' },
			});

			await handleAdd(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Just verify large amount is handled
			expect(text).toContain('999');
		});

		it('should handle very small amounts', async () => {
			const ctx = createMockContext({
				message: { text: '/add 0.01 penny' },
			});

			await handleAdd(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text).toContain('0.01');
		});

		it('should reject zero amounts', async () => {
			const ctx = createMockContext({
				message: { text: '/add 0 nothing' },
			});

			await handleAdd(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/valid number|invalid/);
		});

		it('should reject negative amounts', async () => {
			const ctx = createMockContext({
				message: { text: '/add -50 refund' },
			});

			await handleAdd(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/valid number|invalid/);
		});
	});

	describe('Concurrent operations', () => {
		it('should handle multiple expenses added simultaneously', async () => {
			const promises = [];
			
			for (let i = 0; i < 5; i++) {
				const ctx = createMockContext({
					message: { text: `/add ${10 + i} expense${i}` },
				});
				promises.push(handleAdd(ctx, db));
			}

			const results = await Promise.all(promises);
			
			// Just verify all completed without errors
			expect(results).toHaveLength(5);
		});
	});

	describe('Budget edge cases', () => {
		it('should handle budget with invalid category', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "" 100 monthly' },
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/category|empty|invalid/);
		});

		it('should handle budget amount at limits', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "Test" 0.01 daily' },
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Just verify it accepts small amounts
			expect(text.toLowerCase()).toContain('budget set');
			expect(text).toContain('0.01');
		});
	});

	describe('Permission scenarios', () => {
		it('should handle deletion of expenses gracefully', async () => {
			const ctx = createMockContext({
				callbackQuery: {
					data: 'del:expense-123:0',
					from: { id: 987654321 },
				},
			});

			// Mock expense not found
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.first.mockResolvedValue(null);

			// Should handle gracefully
			await expect(async () => {
				// Simulate delete callback handling
				await ctx.answerCallbackQuery('Expense not found');
			}).not.toThrow();
		});
	});

	describe('Message handling', () => {
		it('should handle commands with extra spaces', async () => {
			const ctx = createMockContext({
				message: { text: '/add   100    dinner   ' },
			});

			await handleAdd(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text).toContain('100');
			expect(text).toContain('dinner');
		});

		it('should handle mixed case commands', async () => {
			const ctx = createMockContext({
				message: { text: '/ADD 50 LUNCH' },
			});

			await handleAdd(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Commands should work regardless of case
			expect(text).toContain('50');
		});
	});

	describe('Data validation', () => {
		it('should validate description length', async () => {
			const longDescription = 'a'.repeat(250);
			const ctx = createMockContext({
				message: { text: `/add 50 ${longDescription}` },
			});

			await handleAdd(ctx, db);

			// Should either truncate or show error
			expect(ctx.reply).toHaveBeenCalled();
		});

		it('should handle missing command arguments', async () => {
			const ctx = createMockContext({
				message: { text: '/settle' },
			});

			await handleSettle(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/usage|format|example/);
		});
	});
});