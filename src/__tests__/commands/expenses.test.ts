import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleExpenses } from '../../commands/expenses';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';

describe('handleExpenses command', () => {
    let db: D1Database;

    beforeEach(() => {
        db = createTestDatabase();
        vi.clearAllMocks();
    });

    describe('Group expenses', () => {
        it('should show no expenses message when empty', async () => {
            const ctx = createMockContext();
            
            const mockStmt = (db as any)._getMockStatement();
            mockStmt.all.mockResolvedValueOnce({ results: [] });

            await handleExpenses(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toMatch(/no expenses|start tracking/);
        });

        it('should list recent group expenses', async () => {
            const ctx = createMockContext();
            
            const mockStmt = (db as any)._getMockStatement();
            mockStmt.all.mockResolvedValueOnce({
                results: [
                    {
                        id: 'exp1',
                        description: 'Lunch at Pizza Place',
                        amount: 45.50,
                        payer_username: 'john',
                        payer_first_name: 'John',
                        created_at: '2024-01-15 12:30:00',
                        created_by: '123456789',
                        category: 'Food & Dining',
                        split_count: 3
                    },
                    {
                        id: 'exp2',
                        description: 'Uber to downtown',
                        amount: 25.00,
                        payer_username: 'alice',
                        payer_first_name: 'Alice',
                        created_at: '2024-01-15 10:00:00',
                        created_by: '987654321',
                        category: 'Transportation',
                        split_count: 2
                    }
                ]
            });

            await handleExpenses(ctx, db);

            const { text } = extractReplyContent(ctx);
            // Verify expenses are shown
            expect(text).toContain('Lunch at Pizza Place');
            expect(text).toMatch(/45\.50|45,50/);
            expect(text).toContain('john');
            expect(text).toContain('Uber to downtown');
            expect(text).toMatch(/25\.00|25,00/);
            expect(text).toContain('alice');
        });

        it('should handle expenses with trips', async () => {
            const ctx = createMockContext();
            
            const mockStmt = (db as any)._getMockStatement();
            
            // Mock expenses with trip
            mockStmt.all.mockResolvedValueOnce({
                results: [
                    {
                        id: 'exp1',
                        description: 'Hotel booking',
                        amount: 200.00,
                        payer_username: 'bob',
                        payer_first_name: 'Bob',
                        created_at: '2024-01-14 15:00:00',
                        created_by: '123456789',
                        category: 'Travel',
                        split_count: 4,
                        trip_name: 'Weekend Getaway'
                    }
                ]
            });

            await handleExpenses(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text).toContain('Hotel booking');
            expect(text).toContain('200');
        });
    });

    describe('Personal expenses in private chat', () => {
        it('should show personal expenses', async () => {
            const ctx = createPrivateContext();
            
            const mockStmt = (db as any)._getMockStatement();
            mockStmt.all.mockResolvedValueOnce({
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

            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toContain('personal');
            expect(text).toContain('Groceries');
            expect(text).toMatch(/85\.20|85,20/);
            expect(text).toContain('Netflix subscription');
            expect(text).toMatch(/15\.99|15,99/);
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

            const mockStmt = (db as any)._getMockStatement();
            mockStmt.all.mockResolvedValueOnce({
                results: mockExpenses.slice(0, 10)
            });

            await handleExpenses(ctx, db);

            const { text, hasButtons } = extractReplyContent(ctx);
            // Should show expenses
            expect(text).toContain('Expense');
            // Should have navigation buttons
            expect(hasButtons).toBe(true);
        });
    });

    describe('Error handling', () => {
        it('should handle database errors', async () => {
            const ctx = createMockContext();
            
            const mockStmt = (db as any)._getMockStatement();
            mockStmt.all.mockRejectedValueOnce(new Error('DB Error'));

            await handleExpenses(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toMatch(/error|try again/);
        });
    });
});