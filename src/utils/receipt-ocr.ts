import { Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { reply } from './reply';
import { suggestParticipants } from './participant-suggestions';
import { replyAndCleanup, MESSAGE_LIFETIMES } from './message';
import { deleteUserMessage } from './message-cleanup';
import { generateInsight } from './smart-insights';
import { EXPENSE_CATEGORIES } from './constants';

interface ReceiptData {
    totalAmount?: number;
    items?: string[];
    date?: Date;
    vendor?: string;
    currency?: string;
}

// Simple cache to avoid reprocessing
const receiptCache = new Map<string, { data: ReceiptData; timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

export async function processReceiptImage(
    imageUrl: string,
    env: any
): Promise<ReceiptData> {
    // Check cache
    const cached = receiptCache.get(imageUrl);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    
    try {
        // Fetch image
        const response = await fetch(imageUrl);
        const imageArray = new Uint8Array(await response.arrayBuffer());
        
        // Call AI with structured prompt
        const aiResponse = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
            image: [...imageArray],
            prompt: 'Extract from this receipt: VENDOR: [name] TOTAL: [amount] ITEMS: [item1, item2, ...]',
            max_tokens: 512,
        });

        const responseText = aiResponse.description || aiResponse.response || aiResponse.text || '';
        const receiptData = parseReceiptText(responseText);
        
        // Cache result
        receiptCache.set(imageUrl, { data: receiptData, timestamp: Date.now() });
        
        return receiptData;
    } catch (error) {
        console.error('Receipt processing error:', error);
        throw new Error('Failed to process receipt');
    }
}

function parseReceiptText(text: string): ReceiptData {
    const data: ReceiptData = { currency: 'USD' };
    
    // Try structured format first
    const vendorMatch = text.match(/VENDOR:\s*([^\n]+)/i);
    const totalMatch = text.match(/TOTAL:\s*\$?([\d,]+\.?\d*)/i);
    const itemsMatch = text.match(/ITEMS:\s*([^\n]+)/i);
    
    if (vendorMatch?.[1]) {
        const vendor = vendorMatch[1].trim();
        if (vendor.length <= 40 && !vendor.includes('[name]')) {
            data.vendor = vendor;
        }
    }
    
    if (totalMatch?.[1]) {
        const amount = parseFloat(totalMatch[1].replace(',', ''));
        if (amount > 0) data.totalAmount = amount;
    }
    
    if (itemsMatch?.[1]) {
        data.items = itemsMatch[1].split(',')
            .map(item => item.trim())
            .filter(item => item.length > 2);
    }
    
    // Fallback: find any dollar amount if no total found
    if (!data.totalAmount) {
        const amounts = [...text.matchAll(/\$?([\d,]+\.?\d{2})/g)]
            .map(m => parseFloat(m[1].replace(',', '')))
            .filter(amt => amt > 0 && amt < 10000);
        
        if (amounts.length > 0) {
            data.totalAmount = Math.max(...amounts);
        }
    }
    
    return data;
}

function detectCategory(description: string, amount?: number): string {
    const lower = description.toLowerCase();
    
    // Simple keyword matching
    const categories: { [key: string]: string[] } = {
        'Food & Dining': ['restaurant', 'cafe', 'coffee', 'food', 'lunch', 'dinner', 'pizza', 'burger'],
        'Transportation': ['uber', 'lyft', 'taxi', 'gas', 'fuel', 'parking'],
        'Shopping': ['amazon', 'walmart', 'target', 'store', 'shop'],
        'Groceries': ['grocery', 'supermarket', 'whole foods', 'safeway'],
        'Entertainment': ['movie', 'cinema', 'concert', 'netflix', 'spotify'],
        'Bills & Utilities': ['electric', 'water', 'internet', 'phone', 'verizon'],
        'Healthcare': ['pharmacy', 'cvs', 'walgreens', 'doctor', 'hospital'],
        'Travel': ['hotel', 'airbnb', 'flight', 'airline']
    };
    
    for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.some(keyword => lower.includes(keyword))) {
            return category;
        }
    }
    
    // Amount-based guess
    if (amount) {
        if (amount >= 10 && amount <= 50) {
            const hour = new Date().getHours();
            if ((hour >= 6 && hour <= 10) || (hour >= 11 && hour <= 14) || (hour >= 17 && hour <= 21)) {
                return 'Food & Dining';
            }
        }
    }
    
    return 'Other';
}

export async function handleReceiptUpload(ctx: Context, db: D1Database, env: any) {
    const photo = ctx.message?.photo;
    if (!photo?.length) {
        await ctx.reply('❌ No photo found. Please send a receipt image.');
        return;
    }
    
    try {
        // Get file URL
        const file = await ctx.api.getFile(photo[photo.length - 1].file_id);
        const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
        
        // Show processing message
        const processingMsg = await ctx.reply('🔍 Processing receipt...');
        
        // Process receipt
        let receiptData: ReceiptData;
        try {
            receiptData = await processReceiptImage(fileUrl, env);
        } catch (error) {
            receiptData = {}; // Empty on error
        }
        
        // Delete processing message
        await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
        
        if (!receiptData.totalAmount) {
            await ctx.reply(
                '❌ Could not extract amount from receipt.\n\n' +
                'Please add manually: `/add [amount] [description]`',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Create expense
        const amount = receiptData.totalAmount;
        const description = receiptData.vendor || receiptData.items?.[0]?.substring(0, 50) || 'Receipt expense';
        const category = detectCategory(description, amount);
        
        // Show what we found
        let info = `📄 <b>Receipt Detected</b>\n\n`;
        info += `💵 Amount: <b>$${amount.toFixed(2)}</b>\n`;
        if (receiptData.vendor) info += `🏪 Vendor: ${receiptData.vendor}\n`;
        if (receiptData.items?.length) {
            info += `\n📝 Items: ${receiptData.items.slice(0, 3).join(', ')}`;
            if (receiptData.items.length > 3) info += ` +${receiptData.items.length - 3} more`;
        }
        
        await ctx.reply(info, { parse_mode: 'HTML' });
        
        // Add to database (keeping existing logic)
        const groupId = ctx.chat!.id.toString();
        const userId = ctx.from!.id.toString();
        
        // Delete user message if in group
        if (ctx.chat?.type !== 'private') {
            await deleteUserMessage(ctx);
        }
        
        // Create user if needed
        await db.prepare(
            'INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)'
        ).bind(userId, ctx.from?.username || null, ctx.from?.first_name || null).run();
        
        // Track membership
        await db.prepare(
            'INSERT OR REPLACE INTO group_members (group_id, user_id, active) VALUES (?, ?, TRUE)'
        ).bind(groupId, userId).run();
        
        // Get members for split
        const members = await db.prepare(`
            SELECT u.telegram_id, u.username, u.first_name
            FROM users u
            JOIN group_members gm ON u.telegram_id = gm.user_id
            WHERE gm.group_id = ? AND gm.active = TRUE
        `).bind(groupId).all();
        
        const splitCount = members.results.length;
        const splitAmount = amount / splitCount;
        
        // Create expense
        const expenseId = crypto.randomUUID();
        await db.prepare(
            'INSERT INTO expenses (id, group_id, paid_by, amount, currency, description, category, created_by, is_personal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(expenseId, groupId, userId, amount, 'USD', description, category, userId, false).run();
        
        // Create splits
        for (const member of members.results) {
            await db.prepare(
                'INSERT INTO expense_splits (expense_id, user_id, amount) VALUES (?, ?, ?)'
            ).bind(expenseId, member.telegram_id as string, splitAmount).run();
        }
        
        // Success message
        const username = ctx.from?.username || ctx.from?.first_name || 'Someone';
        let message = `✅ <b>Receipt expense added!</b>\n\n`;
        message += `💵 <b>${username}</b> paid <b>$${amount.toFixed(2)}</b> for ${description}\n`;
        message += `👥 Split between ${splitCount} ${splitCount === 1 ? 'person' : 'people'} (<b>$${splitAmount.toFixed(2)}</b> each)`;
        
        const insight = generateInsight(description, amount, category, splitCount, []);
        if (insight) message += `\n\n💡 ${insight}`;
        
        await replyAndCleanup(ctx, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '📊 View Balance', callback_data: 'view_balance' },
                    { text: '📈 View Stats', callback_data: 'view_stats' }
                ]]
            }
        }, MESSAGE_LIFETIMES.SUCCESS);
        
    } catch (error) {
        console.error('Error handling receipt:', error);
        await ctx.reply('❌ Failed to process receipt. Please try again or add manually.');
    }
}