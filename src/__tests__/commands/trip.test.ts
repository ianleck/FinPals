import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleTrip } from '../../commands/trip';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';

describe('handleTrip command', () => {
    let db: D1Database;
    let mockPreparedStatement: any;

    beforeEach(() => {
        db = createMockDB();
        mockPreparedStatement = (db as any)._getMockStatement();
        vi.clearAllMocks();
    });

    describe('Command validation', () => {
        it('should show error in private chat', async () => {
            const ctx = createPrivateContext();
            
            await handleTrip(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                '⚠️ This command only works in group chats!'
            );
        });

        it('should show help when no subcommand provided', async () => {
            const ctx = createMockContext({
                message: { text: '/trip' }
            });
            
            await handleTrip(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Trip Management'),
                expect.objectContaining({
                    parse_mode: 'HTML'
                })
            );
        });
    });

    describe('Start trip', () => {
        it('should create a new trip', async () => {
            const ctx = createMockContext({
                message: { text: '/trip start Weekend Getaway' }
            });
            
            // Mock checking active trips
            mockPreparedStatement.first.mockResolvedValueOnce(null);
            
            // Mock trip creation
            mockPreparedStatement.run.mockResolvedValueOnce({
                meta: { changes: 1 }
            });

            await handleTrip(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('✈️ Trip "Weekend Getaway" started!'),
                expect.objectContaining({
                    parse_mode: 'HTML',
                    reply_markup: expect.objectContaining({
                        inline_keyboard: expect.arrayContaining([
                            expect.arrayContaining([
                                expect.objectContaining({ text: '➕ Add Trip Expense' })
                            ])
                        ])
                    })
                })
            );
        });

        it('should not allow multiple active trips', async () => {
            const ctx = createMockContext({
                message: { text: '/trip start New Trip' }
            });
            
            // Mock existing active trip
            mockPreparedStatement.first.mockResolvedValueOnce({
                name: 'Existing Trip'
            });

            await handleTrip(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('already has an active trip: "Existing Trip"'),
                expect.objectContaining({
                    parse_mode: 'HTML'
                })
            );
        });

        it('should require trip name', async () => {
            const ctx = createMockContext({
                message: { text: '/trip start' }
            });
            
            await handleTrip(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Please provide a trip name'),
                expect.objectContaining({
                    parse_mode: 'HTML'
                })
            );
        });
    });

    describe('End trip', () => {
        it('should end active trip and show summary', async () => {
            const ctx = createMockContext({
                message: { text: '/trip end' }
            });
            
            // Mock active trip
            mockPreparedStatement.first.mockResolvedValueOnce({
                id: 'trip1',
                name: 'Beach Weekend'
            });
            
            // Mock trip expenses
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    { paid_by: '123', username: 'john', total: 150.00 },
                    { paid_by: '456', username: 'alice', total: 100.00 }
                ]
            });
            
            // Mock trip balances
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    {
                        user1: '123',
                        user2: '456',
                        net_amount: 25.00,
                        user1_username: 'john',
                        user2_username: 'alice'
                    }
                ]
            });
            
            // Mock end trip
            mockPreparedStatement.run.mockResolvedValueOnce({
                meta: { changes: 1 }
            });

            await handleTrip(ctx, db);

            const replyCall = ctx.reply.mock.calls[0];
            expect(replyCall[0]).toContain('Trip "Beach Weekend" has ended!');
            expect(replyCall[0]).toContain('Trip Summary');
            expect(replyCall[0]).toContain('Total Expenses: $250.00');
            expect(replyCall[0]).toContain('@alice owes @john: $25.00');
        });

        it('should handle no active trip', async () => {
            const ctx = createMockContext({
                message: { text: '/trip end' }
            });
            
            // No active trip
            mockPreparedStatement.first.mockResolvedValueOnce(null);

            await handleTrip(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('No active trip'),
                expect.objectContaining({
                    parse_mode: 'HTML'
                })
            );
        });
    });

    describe('Current trip', () => {
        it('should show current trip details', async () => {
            const ctx = createMockContext({
                message: { text: '/trip current' }
            });
            
            // Mock active trip
            mockPreparedStatement.first.mockResolvedValueOnce({
                id: 'trip1',
                name: 'Summer Vacation',
                created_at: '2024-01-15 10:00:00'
            });
            
            // Mock trip stats
            mockPreparedStatement.first.mockResolvedValueOnce({
                total_expenses: 500.00,
                expense_count: 15
            });
            
            // Mock participants
            mockPreparedStatement.all.mockResolvedValueOnce({
                results: [
                    { username: 'john' },
                    { username: 'alice' },
                    { username: 'bob' }
                ]
            });

            await handleTrip(ctx, db);

            const replyCall = ctx.reply.mock.calls[0];
            expect(replyCall[0]).toContain('Current Trip: Summer Vacation');
            expect(replyCall[0]).toContain('Total Expenses: $500.00 (15)');
            expect(replyCall[0]).toContain('Participants: @john, @alice, @bob');
        });
    });

    describe('Error handling', () => {
        it('should handle database errors', async () => {
            const ctx = createMockContext({
                message: { text: '/trip start Test' }
            });
            
            mockPreparedStatement.first.mockRejectedValueOnce(new Error('DB Error'));

            await handleTrip(ctx, db);

            expect(ctx.reply).toHaveBeenCalledWith(
                '❌ Error managing trip. Please try again.'
            );
        });
    });
});