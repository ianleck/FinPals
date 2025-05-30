import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleTrip } from '../../commands/trip';
import { createMockContext, createPrivateContext } from '../mocks/context';
import { createTestDatabase, extractReplyContent } from '../helpers/test-utils';

describe('handleTrip command', () => {
    let db: D1Database;

    beforeEach(() => {
        db = createTestDatabase();
        vi.clearAllMocks();
    });

    describe('Command validation', () => {
        it('should show error in private chat', async () => {
            const ctx = createPrivateContext();
            
            await handleTrip(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toMatch(/group chat|private/);
        });

        it('should show help when no subcommand provided', async () => {
            const ctx = createMockContext({
                message: { text: '/trip' }
            });
            
            await handleTrip(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toMatch(/trip|help|usage/);
        });
    });

    describe('Start trip', () => {
        it('should create a new trip', async () => {
            const ctx = createMockContext({
                message: { text: '/trip start Weekend Getaway' }
            });
            
            const mockStmt = (db as any)._getMockStatement();
            // Mock checking active trips
            mockStmt.first.mockResolvedValueOnce(null);
            
            // Mock trip creation
            mockStmt.run.mockResolvedValueOnce({
                meta: { changes: 1 }
            });

            await handleTrip(ctx, db);

            const { text, hasButtons } = extractReplyContent(ctx);
            expect(text).toContain('Weekend Getaway');
            expect(text.toLowerCase()).toContain('started');
            expect(hasButtons).toBe(true);
        });

        it('should not allow multiple active trips', async () => {
            const ctx = createMockContext({
                message: { text: '/trip start New Trip' }
            });
            
            const mockStmt = (db as any)._getMockStatement();
            // Mock existing active trip
            mockStmt.first.mockResolvedValueOnce({
                name: 'Existing Trip'
            });

            await handleTrip(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text).toContain('Existing Trip');
            expect(text.toLowerCase()).toMatch(/already|active/);
        });

        it('should require trip name', async () => {
            const ctx = createMockContext({
                message: { text: '/trip start' }
            });
            
            await handleTrip(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toMatch(/name|provide/);
        });
    });

    describe('End trip', () => {
        it('should end active trip and show summary', async () => {
            const ctx = createMockContext({
                message: { text: '/trip end' }
            });
            
            const mockStmt = (db as any)._getMockStatement();
            // Mock active trip
            mockStmt.first.mockResolvedValueOnce({
                id: 'trip1',
                name: 'Beach Weekend'
            });
            
            // Mock trip stats
            mockStmt.first.mockResolvedValueOnce({
                expense_count: 5,
                total_amount: 250.00,
                participants: 3
            });
            
            // Mock end trip update
            mockStmt.run.mockResolvedValueOnce({
                meta: { changes: 1 }
            });

            await handleTrip(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text).toContain('Beach Weekend');
            expect(text.toLowerCase()).toContain('ended');
            expect(text).toContain('5'); // Expense count
            expect(text).toContain('250'); // Total amount
            expect(text).toContain('3'); // Participants
        });

        it('should handle no active trip', async () => {
            const ctx = createMockContext({
                message: { text: '/trip end' }
            });
            
            const mockStmt = (db as any)._getMockStatement();
            // No active trip
            mockStmt.first.mockResolvedValueOnce(null);

            await handleTrip(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toMatch(/no.*trip|not.*active/);
        });
    });

    describe('Current trip', () => {
        it('should show current trip details', async () => {
            const ctx = createMockContext({
                message: { text: '/trip current' }
            });
            
            const mockStmt = (db as any)._getMockStatement();
            // Mock active trip with user info
            mockStmt.first.mockResolvedValueOnce({
                id: 'trip1',
                name: 'Summer Vacation',
                created_at: '2024-01-15 10:00:00',
                username: 'john',
                first_name: 'John'
            });
            
            // Mock trip stats
            mockStmt.first.mockResolvedValueOnce({
                expense_count: 15,
                total_amount: 500.00,
                participants: 3
            });

            await handleTrip(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text).toContain('Summer Vacation');
            expect(text).toContain('500'); // Total amount
            expect(text).toContain('15'); // Expense count
            expect(text).toContain('3'); // Participants
            expect(text).toContain('john'); // Created by
        });
    });

    describe('Error handling', () => {
        it('should handle database errors', async () => {
            const ctx = createMockContext({
                message: { text: '/trip start Test' }
            });
            
            const mockStmt = (db as any)._getMockStatement();
            mockStmt.first.mockRejectedValueOnce(new Error('DB Error'));

            await handleTrip(ctx, db);

            const { text } = extractReplyContent(ctx);
            expect(text.toLowerCase()).toMatch(/error|try again/);
        });
    });
});