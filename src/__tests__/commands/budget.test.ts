import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleBudget } from '../../commands/budget';
import { createPrivateContext, createMockContext } from '../mocks/context';
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';

describe('handleBudget command', () => {
	let db: D1Database;

	beforeEach(() => {
		db = createTestDatabase();
		vi.clearAllMocks();
	});

	describe('Core functionality', () => {
		it('should only work in private chats', async () => {
			const ctx = createMockContext({
				message: { text: '/budget' },
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('private chat');
		});

		it('should show budget menu when no args provided', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget' },
			});

			await handleBudget(ctx, db);

			const { text, hasButtons } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('budget');
			expect(hasButtons).toBe(true);
		});
	});

	describe('Setting budgets', () => {
		it('should set a budget successfully', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "Food & Dining" 500 monthly' },
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('budget set');
			expect(text).toContain('Food & Dining');
			expect(text).toContain('500');
			expect(text.toLowerCase()).toContain('month');
		});

		it('should support different periods', async () => {
			const testCases = [
				{ period: 'daily', expected: 'day' },
				{ period: 'weekly', expected: 'week' },
				{ period: 'monthly', expected: 'month' },
			];

			for (const { period, expected } of testCases) {
				const ctx = createPrivateContext({
					message: { text: `/budget set "Transport" 50 ${period}` },
				});

				await handleBudget(ctx, db);

				const { text } = extractReplyContent(ctx);
				expect(text.toLowerCase()).toContain(expected);
			}
		});

		it('should validate budget amount', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "Food" invalid monthly' },
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/invalid|amount|number/);
		});

		it('should require all parameters', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "Food"' },
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/usage|format|invalid/);
		});

		it('should handle empty category names', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget set "" 100 monthly' },
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/category|empty/);
		});
	});

	describe('Viewing budgets', () => {
		it('should show all budgets with spending', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget view' },
			});

			// Mock existing budgets
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.all.mockResolvedValueOnce({
				results: [
					{
						category: 'Food & Dining',
						amount: 500,
						period: 'monthly',
						spent: 200,
						percentage: 40,
					},
					{
						category: 'Transport',
						amount: 100,
						period: 'weekly',
						spent: 110,
						percentage: 110,
					},
				],
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Verify budget info is shown
			expect(text).toContain('Food & Dining');
			expect(text).toContain('Transport');
			// Just check that percentages/amounts are shown
			expect(text).toMatch(/\d+%/);
		});

		it('should show warning for over-budget categories', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget view' },
			});

			// Mock over-budget scenario
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.all.mockResolvedValueOnce({
				results: [{
					category: 'Shopping',
					amount: 200,
					spent: 250,
					percentage: 125,
				}],
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			// Just verify some kind of warning exists
			expect(text).toMatch(/🚨|⚠️|over|exceed|125%/);
		});

		it('should handle no budgets gracefully', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget view' },
			});

			// Mock no budgets
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.all.mockResolvedValueOnce({ results: [] });

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/no budget|not set|empty/);
		});
	});

	describe('Deleting budgets', () => {
		it('should delete a budget', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget delete "Food & Dining"' },
			});

			// Mock successful deletion
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.run.mockResolvedValueOnce({ meta: { changes: 1 } });

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toContain('removed');
			expect(text).toContain('Food & Dining');
		});

		it('should handle non-existent budget', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget delete "Nonexistent"' },
			});

			// Mock no deletion
			const mockStmt = (db as any)._getMockStatement();
			mockStmt.run.mockResolvedValueOnce({ meta: { changes: 0 } });

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/not found|no budget/);
		});

		it('should require category name', async () => {
			const ctx = createPrivateContext({
				message: { text: '/budget delete' },
			});

			await handleBudget(ctx, db);

			const { text } = extractReplyContent(ctx);
			expect(text.toLowerCase()).toMatch(/specify|category/);
		});
	});
});