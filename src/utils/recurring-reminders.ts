import { Bot, Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { detectRecurringExpenses, RecurringPattern } from './recurring-detection';
import { formatCurrency } from './currency';

interface ReminderConfig {
    checkIntervalHours: number;
    reminderThresholdDays: number;
    maxRemindersPerUser: number;
}

const DEFAULT_CONFIG: ReminderConfig = {
    checkIntervalHours: 24, // Check once daily
    reminderThresholdDays: 2, // Remind 2 days before expected
    maxRemindersPerUser: 3, // Max 3 reminders per check
};

export async function processRecurringReminders<T extends Context = Context>(
    db: D1Database,
    bot: Bot<T>,
    config: ReminderConfig = DEFAULT_CONFIG
): Promise<{ sent: number; errors: number }> {
    const stats = { sent: 0, errors: 0 };
    
    try {
        // Get all active groups
        const groups = await db
            .prepare(`
                SELECT DISTINCT group_id 
                FROM expenses 
                WHERE deleted = FALSE 
                    AND is_personal = FALSE
                    AND created_at > datetime('now', '-90 days')
            `)
            .all();

        for (const group of groups.results) {
            const groupId = group.group_id as string;
            
            // Get active users in the group
            const users = await db
                .prepare(`
                    SELECT DISTINCT paid_by as user_id
                    FROM expenses
                    WHERE group_id = ?
                        AND deleted = FALSE
                        AND created_at > datetime('now', '-30 days')
                `)
                .bind(groupId)
                .all();

            for (const user of users.results) {
                const userId = user.user_id as string;
                
                // Detect recurring patterns for this user
                const patterns = await detectRecurringExpenses(db, groupId);
                
                // Filter patterns that need reminders
                const remindablePatterns = patterns.filter(pattern => {
                    if (!pattern.nextExpectedDate || pattern.confidence < 0.7) return false;
                    
                    const daysUntilNext = Math.floor(
                        (pattern.nextExpectedDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                    );
                    
                    return daysUntilNext >= 0 && daysUntilNext <= config.reminderThresholdDays;
                });

                // Send reminders (limit per user)
                const toRemind = remindablePatterns.slice(0, config.maxRemindersPerUser);
                
                for (const pattern of toRemind) {
                    try {
                        await sendRecurringReminder(bot, groupId, userId, pattern);
                        await recordReminderSent(db, groupId, userId, pattern);
                        stats.sent++;
                    } catch (error) {
                        console.error('Error sending reminder:', error);
                        stats.errors++;
                    }
                }
            }
        }
    } catch (error) {
        console.error('Error processing recurring reminders:', error);
        stats.errors++;
    }

    return stats;
}

async function sendRecurringReminder<T extends Context = Context>(
    bot: Bot<T>,
    groupId: string,
    userId: string,
    pattern: RecurringPattern
): Promise<void> {
    const message = formatReminderMessage(pattern);
    
    // Send to group with mention
    try {
        await bot.api.sendMessage(groupId, message, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: '✅ Add this expense',
                        callback_data: `add_recurring:${pattern.description}:${pattern.averageAmount}`
                    },
                    {
                        text: '🔕 Dismiss',
                        callback_data: 'dismiss_reminder'
                    }
                ]]
            }
        });
    } catch (error) {
        // If can't send to group, try DM
        await bot.api.sendMessage(userId, 
            `💡 Reminder for group expense:\n\n${message}`, 
            { parse_mode: 'HTML' }
        );
    }
}

function formatReminderMessage(pattern: RecurringPattern): string {
    const daysUntil = pattern.nextExpectedDate 
        ? Math.floor((pattern.nextExpectedDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0;
    
    const frequency = pattern.frequency === 'daily' ? 'daily' :
                     pattern.frequency === 'weekly' ? 'weekly' :
                     'monthly';
    
    const when = daysUntil === 0 ? 'today' :
                 daysUntil === 1 ? 'tomorrow' :
                 `in ${daysUntil} days`;
    
    return `🔔 <b>Recurring Expense Reminder</b>\n\n` +
           `You usually add <b>${pattern.description}</b> ${frequency}.\n` +
           `Average amount: <b>${formatCurrency(pattern.averageAmount, 'USD')}</b>\n` +
           `Expected: <b>${when}</b>\n\n` +
           `Would you like to add this expense now?`;
}

async function recordReminderSent(
    db: D1Database,
    groupId: string,
    userId: string,
    pattern: RecurringPattern
): Promise<void> {
    await db
        .prepare(`
            INSERT OR IGNORE INTO recurring_reminders 
            (id, group_id, user_id, description, pattern_frequency, next_expected)
            VALUES (?, ?, ?, ?, ?, ?)
        `)
        .bind(
            crypto.randomUUID(),
            groupId,
            userId,
            pattern.description,
            pattern.frequency,
            pattern.nextExpectedDate?.toISOString().split('T')[0]
        )
        .run();
}

// Check if reminder was already sent recently
export async function wasReminderSentRecently(
    db: D1Database,
    groupId: string,
    userId: string,
    description: string,
    hoursThreshold: number = 24
): Promise<boolean> {
    const result = await db
        .prepare(`
            SELECT COUNT(*) as count
            FROM recurring_reminders
            WHERE group_id = ?
                AND user_id = ?
                AND description = ?
                AND reminder_sent_at > datetime('now', '-${hoursThreshold} hours')
        `)
        .bind(groupId, userId, description)
        .first();

    return (result?.count as number) > 0;
}