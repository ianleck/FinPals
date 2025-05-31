import { Context } from 'grammy';
import { ERROR_MESSAGES } from '../utils/constants';
import { replyAndCleanup, MESSAGE_LIFETIMES } from '../utils/message';
import { deleteUserMessage } from '../utils/message-cleanup';
import { generateInsight } from '../utils/smart-insights';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { suggestParticipants, SuggestionResult } from '../utils/participant-suggestions';

// Keep existing helper functions
function suggestCategory(description: string, amount?: number): string | null {
    const lowerDesc = description.toLowerCase();
    
    // Check for emojis first (high confidence)
    const emojiCategories: { [key: string]: string } = {
        '🍕🍔🍟🌮🍜🍱🍝🥘🍳☕': 'Food & Dining',
        '🚗🚕🚙🚌🚇✈️🛫⛽': 'Transportation',
        '🎬🎮🎯🎪🎭🎨🎵': 'Entertainment',
        '🛍️👗👕👖👠💄': 'Shopping',
        '🏠💡💧📱💻🔌': 'Bills & Utilities',
        '🏨🏖️✈️🗺️🎒': 'Travel',
        '💊💉🏥👨‍⚕️': 'Healthcare',
        '📚📖✏️🎓': 'Education'
    };
    
    for (const [emojis, category] of Object.entries(emojiCategories)) {
        if ([...description].some(char => emojis.includes(char))) {
            return category;
        }
    }

    const categoryKeywords: { [key: string]: string[] } = {
        'Food & Dining': ['lunch', 'dinner', 'breakfast', 'food', 'meal', 'restaurant', 'cafe', 'coffee', 'pizza', 'burger', 'sushi', 'drink', 'bar'],
        Transportation: ['uber', 'lyft', 'taxi', 'gas', 'fuel', 'parking', 'toll', 'bus', 'train', 'flight', 'car'],
        Entertainment: ['movie', 'concert', 'game', 'ticket', 'show', 'netflix', 'spotify', 'museum', 'park'],
        Shopping: ['amazon', 'store', 'buy', 'purchase', 'clothes', 'shoes', 'gift'],
        'Bills & Utilities': ['rent', 'electricity', 'water', 'internet', 'phone', 'bill', 'utility'],
        Travel: ['hotel', 'airbnb', 'booking', 'trip', 'vacation', 'travel'],
        Healthcare: ['doctor', 'medicine', 'pharmacy', 'hospital', 'clinic', 'health'],
        Education: ['book', 'course', 'class', 'tuition', 'school', 'university'],
    };

    let bestMatch = { category: null as string | null, score: 0 };
    
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
        let score = 0;
        for (const keyword of keywords) {
            if (lowerDesc.includes(keyword)) {
                if (lowerDesc.split(/\s+/).includes(keyword)) {
                    score += 2;
                } else {
                    score += 1;
                }
            }
        }
        if (score > bestMatch.score) {
            bestMatch = { category, score };
        }
    }
    
    const hour = new Date().getHours();
    if (!bestMatch.category && lowerDesc.length < 20) {
        if (hour >= 6 && hour < 11) {
            if (['coffee', 'breakfast', 'morning'].some(w => lowerDesc.includes(w))) {
                return 'Food & Dining';
            }
        } else if (hour >= 11 && hour < 15) {
            if (!lowerDesc.includes('uber') && !lowerDesc.includes('taxi')) {
                return 'Food & Dining';
            }
        } else if (hour >= 18 && hour < 22) {
            if (amount && amount > 50) return 'Food & Dining';
            if (amount && amount < 20) return 'Transportation';
        }
    }

    return bestMatch.category;
}

function parseCustomSplits(args: string[]): { mentions: string[]; customSplits: Map<string, number> } {
    const mentions: string[] = [];
    const customSplits = new Map<string, number>();

    for (const arg of args) {
        if (arg.startsWith('@')) {
            if (arg.includes('=')) {
                const [mention, amountStr] = arg.split('=');
                const amount = parseFloat(amountStr);
                if (!isNaN(amount) && amount > 0) {
                    customSplits.set(mention, amount);
                    mentions.push(mention);
                }
            } else {
                mentions.push(arg);
            }
        }
    }

    return { mentions, customSplits };
}


export async function handleAddEnhanced(ctx: Context, db: D1Database) {
    const isPersonal = ctx.chat?.type === 'private';

    const message = ctx.message?.text || '';
    const args = message.split(' ').filter(s => s.length > 0).slice(1);

    if (args.length < 2) {
        const usage = isPersonal
            ? '❌ Invalid format!\n\n' +
              'Usage: /add [amount] [description]\n' +
              'Examples:\n' +
              '• /add 120 lunch\n' +
              '• /add 50 groceries\n' +
              '• /add 30.50 coffee'
            : '❌ Invalid format!\n\n' +
              'Usage: /add [amount] [description] [@mentions]\n' +
              'Examples:\n' +
              '• /add 120 lunch - Split evenly with all\n' +
              '• /add 120 lunch @john @sarah - Split evenly\n' +
              '• /add 120 lunch @john=50 @sarah=70 - Custom amounts';
        
        await replyAndCleanup(ctx, usage, { parse_mode: 'HTML' }, MESSAGE_LIFETIMES.ERROR);
        return;
    }

    const amount = parseFloat(args[0]);
    if (isNaN(amount) || amount <= 0) {
        await replyAndCleanup(ctx, ERROR_MESSAGES.INVALID_AMOUNT, {}, MESSAGE_LIFETIMES.ERROR);
        return;
    }

    // Parse description and mentions
    const descriptionParts: string[] = [];
    const mentionArgs: string[] = [];

    if (isPersonal) {
        for (let i = 1; i < args.length; i++) {
            descriptionParts.push(args[i]);
        }
    } else {
        for (let i = 1; i < args.length; i++) {
            if (args[i].startsWith('@')) {
                mentionArgs.push(args[i]);
            } else if (mentionArgs.length === 0) {
                descriptionParts.push(args[i]);
            }
        }
    }

    const description = descriptionParts.join(' ') || 'Expense';
    const { mentions, customSplits } = parseCustomSplits(mentionArgs);

    const groupId = ctx.chat?.id.toString() || '';
    const paidBy = ctx.from!.id.toString();
    const paidByUsername = ctx.from!.username || ctx.from!.first_name || 'Unknown';

    // For group expenses without mentions, get participant suggestions
    if (!isPersonal && mentions.length === 0) {
        try {
            const suggestionResult = await suggestParticipants(
                db, 
                groupId, 
                description, 
                paidBy,
                { 
                    maxSuggestions: 5,
                    considerTime: true,
                    includeContext: true 
                }
            ) as SuggestionResult;

            if (suggestionResult.suggestions.length > 0) {
                // Batch fetch user details for all participants
                const placeholders = suggestionResult.suggestions.map(() => '?').join(',');
                const userDetails = await db
                    .prepare(`
                        SELECT telegram_id, username, first_name 
                        FROM users 
                        WHERE telegram_id IN (${placeholders})
                    `)
                    .bind(...suggestionResult.suggestions)
                    .all();

                const userMap = new Map(
                    userDetails.results.map(u => [
                        u.telegram_id as string, 
                        u.username || u.first_name || 'User'
                    ])
                );

                // Create interactive message for participant selection
                const participantButtons = suggestionResult.suggestions.map(userId => ({
                    text: `@${userMap.get(userId)} ✓`,
                    callback_data: `toggle_participant:${userId}:${crypto.randomUUID()}`
                }));

                const keyboard = [
                    // Suggested participants row(s)
                    ...chunk(participantButtons, 3),
                    // Action buttons
                    [
                        { text: '➕ Add All Suggested', callback_data: 'add_all_suggested' },
                        { text: '👥 Add Everyone', callback_data: 'add_everyone' }
                    ],
                    [
                        { text: '✅ Confirm with Selected', callback_data: `confirm_expense:${amount}:${description}` },
                        { text: '❌ Cancel', callback_data: 'cancel_expense' }
                    ]
                ];

                await deleteUserMessage(ctx);

                const suggestionMessage = `💡 <b>Adding Expense</b>\n\n` +
                    `💵 Amount: <b>${formatCurrency(amount, 'USD')}</b>\n` +
                    `📝 Description: ${description}\n` +
                    `👤 Paid by: @${paidByUsername}\n\n` +
                    `<b>${suggestionResult.context.message}:</b>\n` +
                    participantButtons.map(btn => `• ${btn.text}`).join('\n') +
                    `\n\n<i>Tap names to toggle, or use the buttons below</i>`;

                await reply(ctx, suggestionMessage, {
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: keyboard }
                });

                return;
            }
        } catch (error) {
            console.error('Error getting participant suggestions:', error);
        }
    }

    // Continue with the existing flow for personal expenses or when mentions are provided
    await handleAddOriginal(ctx, db);
}

// Helper function to chunk array
function chunk<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

// Keep original add logic as fallback
async function handleAddOriginal(ctx: Context, db: D1Database) {
    // This would contain the rest of the original add.ts logic
    // For now, importing and calling the original handleAdd
    const { handleAdd } = await import('./add');
    return handleAdd(ctx, db);
}