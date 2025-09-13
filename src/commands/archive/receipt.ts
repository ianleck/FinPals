import { Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { reply } from '../utils/reply';

interface ReceiptSession {
    expenseId: string;
    waitingForPhoto: boolean;
    timestamp: number;
}

interface Receipt {
    id: string;
    expense_id: string;
    file_id: string;
    file_size: number;
    mime_type: string;
    uploaded_by: string;
    uploaded_at: string;
}

// Store sessions in memory with automatic cleanup
const receiptSessions = new Map<string, ReceiptSession>();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Automatic cleanup interval
let cleanupInterval: NodeJS.Timeout | null = null;

function startCleanupInterval() {
    if (!cleanupInterval) {
        cleanupInterval = setInterval(() => {
            cleanupExpiredSessions();
        }, 60000); // Run every minute
    }
}

function stopCleanupInterval() {
    if (cleanupInterval && receiptSessions.size === 0) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
    }
}

export async function handleReceiptCallback(ctx: Context, db: D1Database) {
    const expenseId = ctx.callbackQuery?.data?.split(':')[1];
    if (!expenseId) {
        await ctx.answerCallbackQuery('Error: Invalid expense ID');
        return;
    }
    
    const userId = ctx.from?.id.toString();
    if (!userId) return;
    
    // Check if expense exists and user has access
    const expense = await db.prepare(`
        SELECT e.*, g.title as group_title
        FROM expenses e
        LEFT JOIN groups g ON e.group_id = g.telegram_id
        WHERE e.id = ? AND (
            e.created_by = ? OR 
            e.paid_by = ? OR
            EXISTS (SELECT 1 FROM expense_splits WHERE expense_id = e.id AND user_id = ?)
        )
    `).bind(expenseId, userId, userId, userId).first();
    
    if (!expense) {
        await ctx.answerCallbackQuery('❌ Expense not found or access denied');
        return;
    }
    
    // Check if receipt already exists
    const existingReceipt = await db.prepare(`
        SELECT * FROM receipts WHERE expense_id = ?
    `).bind(expenseId).first();
    
    if (existingReceipt) {
        await ctx.answerCallbackQuery('📎 Receipt already attached');
        await ctx.reply('📎 Receipt already attached to this expense', { parse_mode: 'HTML' });
        return;
    }
    
    // Store session with timestamp
    receiptSessions.set(userId, {
        expenseId,
        waitingForPhoto: true,
        timestamp: Date.now()
    });
    
    // Start cleanup interval if not running
    startCleanupInterval();
    
    await ctx.answerCallbackQuery();
    await ctx.reply(
        '📷 <b>Send Receipt Photo</b>\n\n' +
        `Please send a photo of the receipt for:\n` +
        `💵 ${expense.description} - $${expense.amount}\n\n` +
        '⏱ You have 5 minutes to send the photo.',
        { 
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '❌ Cancel', callback_data: 'cancel_receipt' }]
                ]
            }
        }
    );
}

export async function handlePhotoMessage(ctx: Context, db: D1Database) {
    const userId = ctx.from?.id.toString();
    if (!userId) return false;
    
    // Check if user has an active receipt session
    const session = receiptSessions.get(userId);
    if (!session || !session.waitingForPhoto) {
        return false; // Not handled by receipt system
    }
    
    const photo = ctx.message?.photo;
    if (!photo || photo.length === 0) {
        await ctx.reply('❌ Please send a photo');
        return true;
    }
    
    // Get the largest photo size
    const largestPhoto = photo[photo.length - 1];
    const fileId = largestPhoto.file_id;
    const fileSize = largestPhoto.file_size;
    
    try {
        // Store receipt metadata
        const receiptId = crypto.randomUUID();
        await db.prepare(`
            INSERT INTO receipts (id, expense_id, file_id, file_size, mime_type, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
            receiptId,
            session.expenseId,
            fileId,
            fileSize || 0,
            'image/jpeg', // Telegram photos are usually JPEG
            userId
        ).run();
        
        // Clear session
        receiptSessions.delete(userId);
        
        // Stop cleanup interval if no more sessions
        stopCleanupInterval();
        
        // Get expense details for confirmation
        const expense = await db.prepare(`
            SELECT description, amount FROM expenses WHERE id = ?
        `).bind(session.expenseId).first();
        
        await ctx.reply(
            `✅ Receipt attached to: <b>${expense?.description}</b> ($${expense?.amount})`,
            {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 View Expense', callback_data: `exp:${session.expenseId}` }],
                        [{ text: '✅ Done', callback_data: 'close' }]
                    ]
                }
            }
        );
        
        return true;
    } catch (error) {
        console.error('Error saving receipt:', error);
        await ctx.reply('❌ Error saving receipt. Please try again.');
        return true;
    }
}

export async function handleCancelReceipt(ctx: Context) {
    const userId = ctx.from?.id.toString();
    if (userId) {
        receiptSessions.delete(userId);
        stopCleanupInterval();
    }
    
    await ctx.answerCallbackQuery('Receipt upload cancelled');
    await ctx.deleteMessage();
}

export async function getExpenseReceipt(db: D1Database, expenseId: string): Promise<Receipt | null> {
    const result = await db.prepare(`
        SELECT * FROM receipts WHERE expense_id = ?
    `).bind(expenseId).first();
    return result as Receipt | null;
}

// Cleanup function to remove expired sessions
function cleanupExpiredSessions() {
    const now = Date.now();
    let hasExpired = false;
    for (const [userId, session] of receiptSessions.entries()) {
        if (now - session.timestamp > SESSION_TIMEOUT) {
            receiptSessions.delete(userId);
            hasExpired = true;
        }
    }
    
    // Stop interval if no sessions left
    if (hasExpired) {
        stopCleanupInterval();
    }
}