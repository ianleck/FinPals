import { Context } from 'grammy';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { parseEnhancedSplits } from '../utils/split-parser';

export async function handleEdit(ctx: Context, db: D1Database) {
    const message = ctx.message?.text || '';
    const args = message.split(' ').filter(s => s.length > 0).slice(1);
    
    if (args.length < 2) {
        await reply(ctx, 
            '❌ Invalid format!\n\n' +
            'Usage: /edit [expense_id] [field] [new_value]\n\n' +
            'Fields:\n' +
            '• amount - Change expense amount\n' +
            '• description - Change description\n' +
            '• category - Change category\n' +
            '• splits - Change how it\'s split\n\n' +
            'Examples:\n' +
            '• /edit abc123 amount 50\n' +
            '• /edit abc123 description "Team lunch"\n' +
            '• /edit abc123 category "Food & Dining"\n' +
            '• /edit abc123 splits @john=30 @mary=20',
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    const [expenseId, field, ...valueArgs] = args;
    const value = valueArgs.join(' ');
    
    if (!value) {
        await reply(ctx, '❌ Please provide a new value');
        return;
    }
    
    const userId = ctx.from!.id.toString();
    const groupId = ctx.chat?.id.toString();
    
    try {
        // Get expense details
        const expense = await db.prepare(`
            SELECT 
                e.*,
                u.username as payer_username,
                u.first_name as payer_first_name
            FROM expenses e
            JOIN users u ON e.paid_by = u.telegram_id
            WHERE e.id = ? AND e.deleted = FALSE
        `).bind(expenseId).first();
        
        if (!expense) {
            await reply(ctx, '❌ Expense not found');
            return;
        }
        
        // Check permissions - only creator or payer can edit
        if (expense.created_by !== userId && expense.paid_by !== userId) {
            await reply(ctx, '❌ Only the expense creator or payer can edit it');
            return;
        }
        
        // Ensure it's from the right group/personal context
        const isPersonal = ctx.chat?.type === 'private';
        if (isPersonal && !expense.is_personal) {
            await reply(ctx, '❌ This is a group expense. Edit it in the group.');
            return;
        }
        if (!isPersonal && expense.group_id !== groupId) {
            await reply(ctx, '❌ This expense belongs to a different group');
            return;
        }
        
        let updateMessage = '';
        
        switch (field.toLowerCase()) {
            case 'amount': {
                const newAmount = parseFloat(value);
                if (isNaN(newAmount) || newAmount <= 0) {
                    await reply(ctx, '❌ Invalid amount');
                    return;
                }
                
                await db.prepare('UPDATE expenses SET amount = ? WHERE id = ?')
                    .bind(newAmount, expenseId)
                    .run();
                
                // If not personal, update splits proportionally
                if (!expense.is_personal) {
                    const oldAmount = expense.amount as number;
                    const ratio = newAmount / oldAmount;
                    
                    await db.prepare(`
                        UPDATE expense_splits 
                        SET amount = amount * ? 
                        WHERE expense_id = ?
                    `).bind(ratio, expenseId).run();
                }
                
                updateMessage = `✅ Amount updated from ${formatCurrency(expense.amount as number, expense.currency as string)} to ${formatCurrency(newAmount, expense.currency as string)}`;
                break;
            }
            
            case 'description': {
                const newDescription = value.trim();
                if (!newDescription) {
                    await reply(ctx, '❌ Description cannot be empty');
                    return;
                }
                
                await db.prepare('UPDATE expenses SET description = ? WHERE id = ?')
                    .bind(newDescription, expenseId)
                    .run();
                
                updateMessage = `✅ Description updated to "${newDescription}"`;
                break;
            }
            
            case 'category': {
                const newCategory = value.trim();
                const validCategories = [
                    'Food & Dining', 'Transportation', 'Entertainment', 
                    'Shopping', 'Bills & Utilities', 'Travel', 
                    'Healthcare', 'Education', 'Other'
                ];
                
                if (!validCategories.includes(newCategory)) {
                    await reply(ctx, 
                        '❌ Invalid category. Valid categories:\n' + 
                        validCategories.join(', ')
                    );
                    return;
                }
                
                await db.prepare('UPDATE expenses SET category = ? WHERE id = ?')
                    .bind(newCategory, expenseId)
                    .run();
                
                updateMessage = `✅ Category updated to "${newCategory}"`;
                break;
            }
            
            case 'splits': {
                if (expense.is_personal) {
                    await reply(ctx, '❌ Cannot change splits for personal expenses');
                    return;
                }
                
                // Parse new splits
                const splitArgs = value.split(' ').filter(s => s.startsWith('@'));
                if (splitArgs.length === 0) {
                    await reply(ctx, '❌ Please specify participants with @mentions');
                    return;
                }
                
                let parsedSplits;
                try {
                    parsedSplits = parseEnhancedSplits(splitArgs, expense.amount as number);
                } catch (error: any) {
                    await reply(ctx, `❌ ${error.message}`);
                    return;
                }
                
                // Delete old splits
                await db.prepare('DELETE FROM expense_splits WHERE expense_id = ?')
                    .bind(expenseId)
                    .run();
                
                // Add new splits
                const { splits } = parsedSplits;
                const splitEntries: Array<{userId: string, amount: number}> = [];
                
                for (const [mention, splitInfo] of splits) {
                    // Resolve username to user ID
                    const username = mention.substring(1);
                    const user = await db.prepare(
                        'SELECT telegram_id FROM users WHERE username = ?'
                    ).bind(username).first();
                    
                    if (user) {
                        splitEntries.push({
                            userId: user.telegram_id as string,
                            amount: splitInfo.value
                        });
                    }
                }
                
                // Insert new splits
                if (splitEntries.length > 0) {
                    const values = splitEntries.map(() => '(?, ?, ?)').join(',');
                    const bindings: any[] = [];
                    
                    for (const split of splitEntries) {
                        bindings.push(expenseId, split.userId, split.amount);
                    }
                    
                    await db.prepare(
                        `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ${values}`
                    ).bind(...bindings).run();
                }
                
                updateMessage = `✅ Splits updated for ${splitEntries.length} participants`;
                break;
            }
            
            default:
                await reply(ctx, '❌ Invalid field. Use: amount, description, category, or splits');
                return;
        }
        
        // Show update confirmation
        const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
        await reply(ctx,
            `${updateMessage}\n\n` +
            `📝 <b>Expense Details:</b>\n` +
            `ID: <code>${expenseId}</code>\n` +
            `Description: ${expense.description}\n` +
            `Amount: ${formatCurrency(expense.amount as number, expense.currency as string)}\n` +
            `Paid by: @${payerName}\n` +
            `Category: ${expense.category || 'Uncategorized'}`,
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✏️ Edit Again', callback_data: `edit:${expenseId}` },
                            { text: '🗑️ Delete', callback_data: `del:${expenseId}` }
                        ],
                        [{ text: '✅ Done', callback_data: 'close' }]
                    ]
                }
            }
        );
        
    } catch (error) {
        console.error('Error editing expense:', error);
        await reply(ctx, '❌ Error editing expense. Please try again.');
    }
}

// Handle edit callbacks from expense list
export async function handleEditCallback(ctx: Context, db: D1Database, expenseId: string) {
    await ctx.answerCallbackQuery();
    
    try {
        const expense = await db.prepare(`
            SELECT 
                e.*,
                u.username as payer_username,
                u.first_name as payer_first_name
            FROM expenses e
            JOIN users u ON e.paid_by = u.telegram_id
            WHERE e.id = ? AND e.deleted = FALSE
        `).bind(expenseId).first();
        
        if (!expense) {
            await ctx.reply('❌ Expense not found');
            return;
        }
        
        const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
        
        await ctx.reply(
            `✏️ <b>Edit Expense</b>\n\n` +
            `ID: <code>${expenseId}</code>\n` +
            `Description: ${expense.description}\n` +
            `Amount: ${formatCurrency(expense.amount as number, expense.currency as string)}\n` +
            `Paid by: @${payerName}\n` +
            `Category: ${expense.category || 'Uncategorized'}\n\n` +
            `To edit, use:\n` +
            `<code>/edit ${expenseId} amount 75</code>\n` +
            `<code>/edit ${expenseId} description New description</code>\n` +
            `<code>/edit ${expenseId} category Food & Dining</code>\n` +
            `<code>/edit ${expenseId} splits @john=40 @mary=35</code>`,
            { parse_mode: 'HTML' }
        );
    } catch (error) {
        console.error('Error showing edit info:', error);
        await ctx.reply('❌ Error loading expense details');
    }
}