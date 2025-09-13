import { Context } from 'grammy';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { ERROR_MESSAGES } from '../utils/constants';

interface ExpenseTemplate {
    id: string;
    user_id: string;
    group_id?: string;
    name: string;
    description: string;
    amount: number;
    category?: string;
    participants?: string;
    shortcut?: string;
    preferred_time?: string;
    usage_count: number;
    last_used?: string;
    created_at: string;
}

export async function handleTemplates(ctx: Context, db: D1Database) {
    const message = ctx.message?.text || '';
    const args = message.split(' ').slice(1);
    const userId = ctx.from!.id.toString();
    const groupId = ctx.chat?.type !== 'private' ? ctx.chat?.id.toString() : undefined;

    // Handle subcommands
    if (args.length > 0) {
        const subcommand = args[0].toLowerCase();
        
        switch (subcommand) {
            case 'create':
                return handleCreateTemplate(ctx, db, args.slice(1));
            case 'edit':
                return handleEditTemplate(ctx, db, args.slice(1));
            case 'delete':
                return handleDeleteTemplate(ctx, db, args.slice(1));
            default:
                // Continue to show templates
                break;
        }
    }

    try {
        // Get user's templates
        const templatesQuery = `
            SELECT * FROM expense_templates
            WHERE user_id = ?
                AND (group_id IS NULL OR group_id = ?)
                AND deleted = FALSE
            ORDER BY usage_count DESC, last_used DESC
            LIMIT 10
        `;

        const templates = await db
            .prepare(templatesQuery)
            .bind(userId, groupId)
            .all();

        if (!templates.results || templates.results.length === 0) {
            // No templates, suggest creating some
            await suggestTemplateCreation(ctx, db, userId, groupId);
            return;
        }

        // Display templates
        await displayTemplates(ctx, templates.results as unknown as ExpenseTemplate[]);

    } catch (error) {
        await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
    }
}

async function displayTemplates(ctx: Context, templates: ExpenseTemplate[]) {
    let message = '📋 <b>Your Expense Templates</b>\n\n';
    const keyboard: any[][] = [];

    templates.forEach((template, index) => {
        const participants = template.participants ? 
            JSON.parse(template.participants).length : 
            'all';
        
        message += `<b>${index + 1}. ${template.name}</b>\n`;
        message += `   💵 ${formatCurrency(template.amount, 'USD')}\n`;
        message += `   📝 "${template.description}"\n`;
        if (template.category) {
            message += `   📂 ${template.category}\n`;
        }
        message += `   👥 Split with: ${participants === 'all' ? 'everyone' : `${participants} people`}\n`;
        message += `   📊 Used ${template.usage_count} times\n`;
        if (template.shortcut) {
            message += `   ⚡ Shortcut: /${template.shortcut}\n`;
        }
        message += '\n';

        // Add quick use button
        keyboard.push([{
            text: `💵 Use "${template.name}"`,
            callback_data: `use_template:${template.id}`
        }]);
    });

    // Add management buttons
    keyboard.push([
        { text: '➕ Create New', callback_data: 'create_template' },
        { text: '⚙️ Manage', callback_data: 'manage_templates' }
    ]);
    keyboard.push([{ text: '❌ Close', callback_data: 'close' }]);

    await reply(ctx, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
    });
}

async function suggestTemplateCreation(ctx: Context, db: D1Database, userId: string, groupId?: string) {
    try {
        // Find frequently added expenses
        const frequentExpensesQuery = `
            SELECT 
                description,
                COUNT(*) as count,
                AVG(amount) as avg_amount,
                category
            FROM expenses
            WHERE created_by = ?
                ${groupId ? 'AND group_id = ?' : 'AND is_personal = TRUE'}
                AND deleted = FALSE
                AND created_at > datetime('now', '-30 days')
            GROUP BY LOWER(description)
            HAVING count >= 3
            ORDER BY count DESC
            LIMIT 5
        `;

        const bindings = groupId ? [userId, groupId] : [userId];
        const frequentExpenses = await db
            .prepare(frequentExpensesQuery)
            .bind(...bindings)
            .all();

        let message = "📋 <b>You don't have any templates yet!</b>\n\n";
        const keyboard: any[][] = [];

        if (frequentExpenses.results && frequentExpenses.results.length > 0) {
            message += "Based on your history, you frequently add:\n\n";
            
            frequentExpenses.results.forEach((expense: any) => {
                message += `• <b>${expense.description}</b> (~${formatCurrency(expense.avg_amount, 'USD')}) - ${expense.count} times\n`;
                
                keyboard.push([{
                    text: `➕ Create "${expense.description}" template`,
                    callback_data: `create_template:${expense.description}:${expense.avg_amount}`
                }]);
            });
            
            message += '\n<i>Tap to create a template for quick access!</i>';
        } else {
            message += 'Templates let you quickly add frequent expenses with a single command.\n\n';
            message += '<b>Examples:</b>\n';
            message += '• Morning coffee\n';
            message += '• Daily lunch\n';
            message += '• Weekly groceries\n';
            message += '• Monthly rent\n\n';
            message += 'Use <code>/templates create "name" amount</code> to get started!';
        }

        keyboard.push([{ text: '❌ Close', callback_data: 'close' }]);

        await reply(ctx, message, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        });

    } catch (error) {
        await reply(ctx, '📋 Templates let you quickly add frequent expenses.\n\nUse <code>/templates create "name" amount</code> to get started!', {
            parse_mode: 'HTML'
        });
    }
}

async function handleCreateTemplate(ctx: Context, db: D1Database, args: string[]) {
    if (args.length < 2) {
        await reply(ctx, 
            '❌ <b>Invalid format!</b>\n\n' +
            'Usage: <code>/templates create "name" amount [description]</code>\n\n' +
            'Examples:\n' +
            '• <code>/templates create "Morning Coffee" 5</code>\n' +
            '• <code>/templates create "Team Lunch" 25 "lunch with team"</code>\n' +
            '• <code>/templates create "Uber Home" 15 @john @sarah</code>',
            { parse_mode: 'HTML' }
        );
        return;
    }

    // Parse template name (in quotes)
    const nameMatch = args.join(' ').match(/"([^"]+)"/);
    if (!nameMatch) {
        await reply(ctx, '❌ Template name must be in quotes!');
        return;
    }

    const name = nameMatch[1];
    const restArgs = args.join(' ').replace(nameMatch[0], '').trim().split(' ');
    const amount = parseFloat(restArgs[0]);

    if (isNaN(amount) || amount <= 0) {
        await reply(ctx, ERROR_MESSAGES.INVALID_AMOUNT);
        return;
    }

    const description = restArgs.slice(1).join(' ') || name;
    const userId = ctx.from!.id.toString();
    const groupId = ctx.chat?.type !== 'private' ? ctx.chat?.id.toString() : undefined;

    try {
        // Create template
        const templateId = crypto.randomUUID();
        
        await db.prepare(`
            INSERT INTO expense_templates (
                id, user_id, group_id, name, description, 
                amount, usage_count, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))
        `).bind(
            templateId,
            userId,
            groupId,
            name,
            description,
            amount
        ).run();

        // Generate shortcut
        const shortcut = name.toLowerCase()
            .replace(/[^a-z0-9]/g, '')
            .substring(0, 10);

        // Try to set shortcut if unique
        try {
            await db.prepare(`
                UPDATE expense_templates 
                SET shortcut = ? 
                WHERE id = ? 
                AND NOT EXISTS (
                    SELECT 1 FROM expense_templates 
                    WHERE shortcut = ? AND user_id = ? AND deleted = FALSE
                )
            `).bind(shortcut, templateId, shortcut, userId).run();
        } catch {
            // Shortcut not unique, skip
        }

        const successMessage = `✅ <b>Template created!</b>\n\n` +
            `📋 Name: <b>${name}</b>\n` +
            `💵 Amount: ${formatCurrency(amount, 'USD')}\n` +
            `📝 Description: ${description}\n` +
            (shortcut ? `⚡ Quick use: <code>/${shortcut}</code>\n` : '') +
            '\n<i>Use /templates to manage your templates</i>';

        await reply(ctx, successMessage, { parse_mode: 'HTML' });

    } catch (error) {
        await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
    }
}

async function handleEditTemplate(ctx: Context, db: D1Database, args: string[]) {
    // Implementation for editing templates
    await reply(ctx, 'Template editing coming soon! Use /templates delete and create a new one for now.');
}

async function handleDeleteTemplate(ctx: Context, db: D1Database, args: string[]) {
    if (args.length === 0) {
        await reply(ctx, '❌ Please specify the template name to delete.\n\nUsage: <code>/templates delete "name"</code>', {
            parse_mode: 'HTML'
        });
        return;
    }

    const nameMatch = args.join(' ').match(/"([^"]+)"/);
    if (!nameMatch) {
        await reply(ctx, '❌ Template name must be in quotes!');
        return;
    }

    const name = nameMatch[1];
    const userId = ctx.from!.id.toString();

    try {
        const result = await db.prepare(`
            UPDATE expense_templates 
            SET deleted = TRUE 
            WHERE name = ? AND user_id = ? AND deleted = FALSE
        `).bind(name, userId).run();

        if (result.meta.changes > 0) {
            await reply(ctx, `✅ Template "${name}" has been deleted.`);
        } else {
            await reply(ctx, `❌ Template "${name}" not found.`);
        }
    } catch (error) {
        await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
    }
}

// Handle quick template usage like /coffee
export async function handleQuickAdd(ctx: Context, db: D1Database, shortcut: string) {
    const userId = ctx.from!.id.toString();
    const groupId = ctx.chat?.type !== 'private' ? ctx.chat?.id.toString() : undefined;

    try {
        // Find template by shortcut
        const template = await db.prepare(`
            SELECT * FROM expense_templates
            WHERE shortcut = ? 
                AND user_id = ?
                AND (group_id IS NULL OR group_id = ?)
                AND deleted = FALSE
        `).bind(shortcut, userId, groupId).first() as ExpenseTemplate | null;

        if (!template) {
            await reply(ctx, `❌ No template found for /${shortcut}\n\nUse /templates to see your templates.`);
            return;
        }

        // Create expense from template
        const expenseId = crypto.randomUUID();
        
        await db.prepare(`
            INSERT INTO expenses (
                id, group_id, amount, description, category,
                paid_by, created_by, is_personal, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
            expenseId,
            groupId,
            template.amount,
            template.description,
            template.category,
            userId,
            userId,
            !groupId
        ).run();

        // Add splits
        if (template.participants) {
            const participants = JSON.parse(template.participants);
            const splitAmount = template.amount / participants.length;
            
            for (const participantId of participants) {
                await db.prepare(`
                    INSERT INTO expense_splits (expense_id, user_id, amount)
                    VALUES (?, ?, ?)
                `).bind(expenseId, participantId, splitAmount).run();
            }
        } else {
            // Default split with creator
            await db.prepare(`
                INSERT INTO expense_splits (expense_id, user_id, amount)
                VALUES (?, ?, ?)
            `).bind(expenseId, userId, template.amount).run();
        }

        // Update template usage
        await db.prepare(`
            UPDATE expense_templates
            SET usage_count = usage_count + 1,
                last_used = datetime('now')
            WHERE id = ?
        `).bind(template.id).run();

        const message = `✅ <b>Expense Added from Template</b>\n\n` +
            `📋 Template: <b>${template.name}</b>\n` +
            `💵 Amount: ${formatCurrency(template.amount, 'USD')}\n` +
            `📝 Description: ${template.description}\n` +
            (template.category ? `📂 Category: ${template.category}\n` : '') +
            `\n<i>Quick add successful!</i>`;

        await reply(ctx, message, { parse_mode: 'HTML' });

    } catch (error) {
        await reply(ctx, ERROR_MESSAGES.DATABASE_ERROR);
    }
}