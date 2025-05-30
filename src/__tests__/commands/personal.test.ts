import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handlePersonal } from '../../commands/personal';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';

describe('handlePersonal command', () => {
	let db: D1Database;

	beforeEach(() => {
		db = createTestDatabase();
		vi.clearAllMocks();
	});

	describe('Command validation', () => {
		it('should only work in private chats', async () => {
			const ctx = createMockContext({
				message: { text: '/personal' },
			});

			await handlePersonal(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/private chat|dm me/);
		});

		it('should work in private chat', async () => {
			const ctx = createPrivateContext({
				message: { text: '/personal' },
			});

			await handlePersonal(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('personal');
			// Should show some kind of summary
			expect(text.toLowerCase()).toMatch(/summary|expense|total/);
		});
	});

	describe('Personal expense summary', () => {
		it('should show empty state when no expenses', async () => {
			const ctx = createPrivateContext({
				message: { text: '/personal' },
			});

			// Mock no data for all queries
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.all.mockResolvedValue({ results: [] });
			mockStmt.first.mockResolvedValue(null);

			await handlePersonal(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('personal summary');
			expect(text.toLowerCase()).toMatch(/settled up|no.+owe/);
		});

		it('should show expense summary with categories', async () => {
			const ctx = createPrivateContext({
				message: { text: '/personal' },
			});

			// Mock all the queries personal command makes
			const mockStmt = (db as any)._getMockStatement();
			// Mock balances (empty)
			mockStmt.all.mockResolvedValueOnce({ results: [] });
			// Mock spending by group
			mockStmt.all.mockResolvedValueOnce({
				results: [
					{ group_name: 'Test Group', expense_count: 2, total_paid: 100 },
				],
			});
			// Mock categories
			mockStmt.all.mockResolvedValueOnce({
				results: [
					{ category: 'Food & Dining', total: 150.50, count: 5 },
					{ category: 'Transport', total: 75.25, count: 3 },
				],
			});
			// Mock personal expense summary
			mockStmt.first.mockResolvedValueOnce({
				expense_count: 10,
				total_amount: 500,
				avg_amount: 50
			});
			// Mock personal categories
			mockStmt.all.mockResolvedValueOnce({
				results: [
					{ category: 'Groceries', total: 300, count: 6 },
					{ category: 'Entertainment', total: 200, count: 4 },
				],
			});

			await handlePersonal(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Verify categories and amounts are shown
			expect(text).toContain('Food & Dining');
			expect(text).toContain('Transport');
			expect(text).toContain('Groceries');
			expect(text).toContain('Entertainment');
		});
	});


	describe('Error handling', () => {
		it('should handle database errors gracefully', async () => {
			const ctx = createPrivateContext({
				message: { text: '/personal' },
			});

			// Mock database error
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.all.mockRejectedValue(new Error('DB Error'));

			await handlePersonal(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/error|try again|failed/);
		});
	});
});