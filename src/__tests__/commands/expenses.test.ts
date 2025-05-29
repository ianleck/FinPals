import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleExpenses } from '../../commands/expenses';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('handleExpenses command', () => {
    let db: D1Database;
    let mockPreparedStatement: any;

    beforeEach(() => {
        db = createMockDB();
        mockPreparedStatement = (db as any)._getMockStatement();
        vi.clearAllMocks();
    });

    describe('Group expenses', () => {
        it('should show no expenses message when empty', async () => {
            const ctx = createMockContext();
            
            mockPreparedStatement.all.mockResolvedValueOnce({ results: [] });

            await handleExpenses(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('No expenses recorded'),
                expect.objectContaining({
                    parse_mode: 'HTML',
                    reply_markup: expect.objectContaining({
                        inline_keyboard: expect.arrayContaining([
                            expect.arrayContaining([
                                expect.objectContaining({ text: '➕ Add Expense' })
                            ])
                        ])
                    })
                })
            );
        });

        it('should list recent group expenses', async () => {
            const ctx = createMockContext();
            
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        id: 'exp1',
                        description: 'Lunch at Pizza Place',
                        amount: 45.50,
                        paid_by_username: 'john',
                        created_at: '2024-01-15 12:30:00',
                        created_by_username: 'john',
                        category: 'Food & Dining'
                    },
                    {
                        id: 'exp2',
                        description: 'Uber to downtown',
                        amount: 25.00,
                        paid_by_username: 'alice',
                        created_at: '2024-01-15 10:00:00',
                        created_by_username: 'alice',
                        category: 'Transportation'
                    }
                ]
            });

            await handleExpenses(ctx, db);

            const replyCall = ctx.reply.mock.calls[0];
            expect(replyCall[0]).toContain('Recent Expenses');
            expect(replyCall[0]).toContain('Lunch at Pizza Place');
            expect(replyCall[0]).toContain('$45.50');
            expect(replyCall[0]).toContain('@john');
            expect(replyCall[0]).toContain('Uber to downtown');
            expect(replyCall[0]).toContain('$25.00');
            expect(replyCall[0]).toContain('@alice');
        });

        it('should handle trip filter', async () => {
            const ctx = createMockContext({
                message: { text: '/expenses trip:1' }
            });
            
            // Mock trip info
            mockPreparedStatement.first.mockResolvedValueOnce({
                name: 'Weekend Getaway'
            });
            
            // Mock expenses
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        id: 'exp1',
                        description: 'Hotel booking',
                        amount: 200.00,
                        paid_by_username: 'bob',
                        created_at: '2024-01-14 15:00:00',
                        created_by_username: 'bob',
                        category: 'Travel'
                    }
                ]
            });

            await handleExpenses(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Weekend Getaway'),
                expect.any(Object)
            );
        });
    });

    describe('Personal expenses in private chat', () => {
        it('should show personal expenses', async () => {
            const ctx = createPrivateContext();
            
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        id: 'exp1',
                        description: 'Groceries',
                        amount: 85.20,
                        paid_by_username: 'testuser',
                        created_at: '2024-01-15 14:00:00',
                        created_by_username: 'testuser',
                        category: 'Groceries'
                    },
                    {
                        id: 'exp2',
                        description: 'Netflix subscription',
                        amount: 15.99,
                        paid_by_username: 'testuser',
                        created_at: '2024-01-15 09:00:00',
                        created_by_username: 'testuser',
                        category: 'Entertainment'
                    }
                ]
            });

            await handleExpenses(ctx, db);

            const replyCall = ctx.reply.mock.calls[0];
            expect(replyCall[0]).toContain('Your Personal Expenses');
            expect(replyCall[0]).toContain('Groceries');
            expect(replyCall[0]).toContain('$85.20');
            expect(replyCall[0]).toContain('Netflix subscription');
            expect(replyCall[0]).toContain('$15.99');
        });
    });

    describe('Pagination', () => {
        it('should limit to 10 expenses per page', async () => {
            const ctx = createMockContext();
            
            // Create 15 mock expenses
            const mockExpenses = Array.from({ length: 15 }, (_, i) => ({
                id: `exp${i}`,
                description: `Expense ${i}`,
                amount: 10.00 + i,
                paid_by_username: 'user',
                created_at: '2024-01-15 12:00:00',
                created_by_username: 'user',
                category: 'Other'
            }));

            mockPreparedStatement.all.mockResolvedValueOnce({
                results: mockExpenses.slice(0, 10)
            });

            await handleExpenses(ctx, db);

            const replyCall = ctx.reply.mock.calls[0];
            // Should only show 10 expenses
            const expenseCount = (replyCall[0].match(/exp\d+/g) || []).length;
            expect(expenseCount).toBe(10);
            
            // Should have pagination button
            expect(replyCall[1].reply_markup.inline_keyboard).toContainEqual(
                expect.arrayContaining([
                    expect.objectContaining({ text: expect.stringContaining('Next') })
                ])
            );
        });
    });

    describe('Error handling', () => {
        it('should handle database errors', async () => {
            const ctx = createMockContext();
            
            mockPreparedStatement.all.mockRejectedValueOnce(new Error('DB Error'));

            await handleExpenses(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                '❌ Error retrieving expenses. Please try again.'
            );
        });
    });
});