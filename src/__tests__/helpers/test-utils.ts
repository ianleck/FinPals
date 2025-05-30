import { Context } from 'grammy';
import { vi, expect } from 'vitest';
import { createMockContext } from '../mocks/context';
import { createMockDB } from '../mocks/database';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * Test utilities that abstract implementation details
 */

export interface TestExpense {
    id: string;
    amount: number;
    description: string;
    paidBy: string;
    participants: string[];
}

/**
 * Helper to create a test expense without worrying about implementation details
 */
export async function createTestExpense(
    handler: Function,
    amount: number,
    description: string,
    mentions: string[] = []
): Promise<{ ctx: Context; response: any }> {
    const ctx = createMockContext({
        message: {
            text: `/add ${amount} ${description} ${mentions.map(m => `@${m}`).join(' ')}`,
            entities: mentions.map((m, i) => ({
                type: 'mention',
                offset: `/add ${amount} ${description} `.length + mentions.slice(0, i).join(' @').length + (i > 0 ? 2 : 0),
                length: m.length + 1
            }))
        }
    });
    
    const db = createMockDB();
    
    // Set up minimal mocks - don't care about exact implementation
    const mockStmt = (db as any)._getMockStatement();
    mockStmt.first.mockResolvedValue({ telegram_id: '-1001234567890' });
    mockStmt.all.mockResolvedValue({ results: [{ user_id: '123456789' }] });
    
    await handler(ctx, db);
    
    return { ctx, response: (ctx.reply as any).mock.calls[0] };
}

/**
 * Helper to verify an expense was created successfully
 */
export function expectExpenseCreated(ctx: Context) {
    expect(ctx.reply).toHaveBeenCalled();
    const message = (ctx.reply as any).mock.calls[0][0];
    expect(message.toLowerCase()).toContain('expense added');
}

/**
 * Helper to verify a settlement was recorded
 */
export function expectSettlementRecorded(ctx: Context, fromUser: string, toUser: string, amount: number) {
    expect(ctx.reply).toHaveBeenCalled();
    const message = (ctx.reply as any).mock.calls[0][0];
    expect(message.toLowerCase()).toContain('settlement recorded');
    expect(message).toContain(fromUser);
    expect(message).toContain(toUser);
    expect(message).toContain(amount.toString());
}

/**
 * Helper to extract key information from bot responses
 */
export function extractReplyContent(ctx: Context): {
    text: string;
    hasButtons: boolean;
    buttonCount: number;
} {
    const call = (ctx.reply as any).mock.calls[0];
    if (!call) return { text: '', hasButtons: false, buttonCount: 0 };
    
    const [text, options] = call;
    const buttons = options?.reply_markup?.inline_keyboard || [];
    
    return {
        text: text.replace(/<[^>]*>/g, ''), // Strip HTML
        hasButtons: buttons.length > 0,
        buttonCount: buttons.flat().length
    };
}

/**
 * Helper to verify budget warnings without implementation details
 */
export function expectBudgetWarning(message: string, category: string) {
    expect(message.toLowerCase()).toContain('budget');
    expect(message).toContain(category);
    expect(message).toMatch(/\d+%|exceed/i);
}

/**
 * Helper to create test database with common data
 */
export function createTestDatabase() {
    const db = createMockDB();
    const mockStmt = (db as any)._getMockStatement();
    
    // Set up common responses
    mockStmt.first.mockImplementation((sql: string) => {
        if (sql?.includes('groups')) {
            return Promise.resolve({ telegram_id: '-1001234567890', title: 'Test Group' });
        }
        if (sql?.includes('users')) {
            return Promise.resolve({ telegram_id: '123456789', username: 'testuser' });
        }
        return Promise.resolve(null);
    });
    
    mockStmt.all.mockImplementation(() => {
        return Promise.resolve({ results: [] });
    });
    
    return db;
}