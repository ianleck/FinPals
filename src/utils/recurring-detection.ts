import { format, addDays, addWeeks, addMonths, differenceInDays } from 'date-fns';
import type { D1Database } from '@cloudflare/workers-types';

export interface RecurringPattern {
    description: string;
    amount: number;
    averageAmount: number;
    frequency: 'daily' | 'weekly' | 'monthly';
    confidence: number;
    nextExpectedDate: Date;
    participants?: string[];
    category?: string;
}

export interface DetectionOptions {
    lookbackDays?: number;
    minOccurrences?: number;
    amountVariationThreshold?: number;
    similarityThreshold?: number;
}

export interface ReminderOptions {
    suggestTemplate?: boolean;
    includeQuickActions?: boolean;
    batchReminders?: boolean;
}

export async function detectRecurringExpenses(
    db: D1Database,
    groupId: string,
    options: DetectionOptions = {}
): Promise<RecurringPattern[]> {
    const {
        lookbackDays = 90,
        minOccurrences = 3,
        amountVariationThreshold = 0.1,
        similarityThreshold = 0.8
    } = options;

    try {
        // Get expense history
        const lookbackDate = new Date();
        lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

        const expenses = await db.prepare(`
            SELECT 
                description,
                amount,
                category,
                paid_by,
                created_at,
                GROUP_CONCAT(DISTINCT es.user_id) as participants
            FROM expenses e
            LEFT JOIN expense_splits es ON e.id = es.expense_id
            WHERE e.group_id = ? 
                AND e.deleted = FALSE
                AND e.created_at >= ?
            GROUP BY e.id
            ORDER BY e.description, e.created_at
        `).bind(groupId, lookbackDate.toISOString()).all();

        if (!expenses.results || expenses.results.length < minOccurrences) {
            return [];
        }

        // Group expenses by similar descriptions
        const groupedExpenses = groupExpensesByDescription(
            expenses.results,
            similarityThreshold
        );

        const patterns: RecurringPattern[] = [];

        // Analyze each group for patterns
        for (const [description, group] of Object.entries(groupedExpenses)) {
            if (group.length < minOccurrences) continue;

            const pattern = analyzeRecurringPattern(
                group,
                amountVariationThreshold
            );

            if (pattern) {
                patterns.push({
                    description: group[0].description, // Use original description
                    ...pattern,
                    participants: extractCommonParticipants(group),
                    category: group[0].category
                });
            }
        }

        return patterns.sort((a, b) => b.confidence - a.confidence);
    } catch (error) {
        console.error('Error detecting recurring expenses:', error);
        return [];
    }
}

function groupExpensesByDescription(
    expenses: any[],
    threshold: number
): Record<string, any[]> {
    const groups: Record<string, any[]> = {};

    for (const expense of expenses) {
        const desc = expense.description.toLowerCase().trim();
        let addedToGroup = false;

        // Check if this expense matches any existing group
        for (const [groupDesc, groupExpenses] of Object.entries(groups)) {
            if (calculateSimilarity(desc, groupDesc) >= threshold) {
                groupExpenses.push(expense);
                addedToGroup = true;
                break;
            }
        }

        // Create new group if no match found
        if (!addedToGroup) {
            groups[desc] = [expense];
        }
    }

    return groups;
}

function calculateSimilarity(str1: string, str2: string): number {
    // Optimized similarity using Jaccard index with word normalization
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '');
    const words1 = new Set(normalize(str1).split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(normalize(str2).split(/\s+/).filter(w => w.length > 2));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    let intersection = 0;
    for (const word of words1) {
        if (words2.has(word)) intersection++;
    }
    
    return intersection / (words1.size + words2.size - intersection);
}

function analyzeRecurringPattern(
    expenses: any[],
    amountThreshold: number
): Omit<RecurringPattern, 'description' | 'participants' | 'category'> | null {
    if (expenses.length < 2) return null;

    // Sort by date
    expenses.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Calculate intervals between consecutive expenses
    const intervals: number[] = [];
    for (let i = 1; i < expenses.length; i++) {
        const days = differenceInDays(
            new Date(expenses[i].created_at),
            new Date(expenses[i-1].created_at)
        );
        intervals.push(days);
    }

    // Determine frequency
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const stdDev = calculateStdDev(intervals);
    
    let frequency: 'daily' | 'weekly' | 'monthly';
    let expectedInterval: number;
    
    if (avgInterval <= 1.5) {
        frequency = 'daily';
        expectedInterval = 1;
    } else if (avgInterval >= 6 && avgInterval <= 8) {
        frequency = 'weekly';
        expectedInterval = 7;
    } else if (avgInterval >= 28 && avgInterval <= 32) {
        frequency = 'monthly';
        expectedInterval = 30;
    } else {
        return null; // No clear pattern
    }

    // Calculate confidence based on interval consistency
    const intervalConsistency = 1 - (stdDev / avgInterval);
    
    // Check amount consistency
    const amounts = expenses.map(e => e.amount);
    const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const amountVariation = calculateVariation(amounts, avgAmount);
    
    if (amountVariation > amountThreshold) {
        // Too much variation in amounts
        return null;
    }

    const amountConsistency = 1 - amountVariation;
    const confidence = (intervalConsistency * 0.7 + amountConsistency * 0.3);

    // Calculate next expected date
    const lastDate = new Date(expenses[expenses.length - 1].created_at);
    let nextExpectedDate: Date;
    
    switch (frequency) {
        case 'daily':
            nextExpectedDate = addDays(lastDate, 1);
            break;
        case 'weekly':
            nextExpectedDate = addWeeks(lastDate, 1);
            break;
        case 'monthly':
            nextExpectedDate = addMonths(lastDate, 1);
            break;
    }

    return {
        amount: avgAmount,
        averageAmount: avgAmount,
        frequency,
        confidence: Math.min(confidence, 1.0),
        nextExpectedDate
    };
}

function calculateStdDev(values: number[]): number {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const squareDiffs = values.map(value => Math.pow(value - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(avgSquareDiff);
}

function calculateVariation(amounts: number[], average: number): number {
    const variations = amounts.map(amount => 
        Math.abs(amount - average) / average
    );
    return Math.max(...variations);
}

function extractCommonParticipants(expenses: any[]): string[] {
    if (!expenses[0].participants) return [];
    
    // Find participants that appear in most expenses
    const participantCounts: Record<string, number> = {};
    
    for (const expense of expenses) {
        if (expense.participants) {
            const participants = expense.participants.split(',');
            for (const participant of participants) {
                participantCounts[participant] = (participantCounts[participant] || 0) + 1;
            }
        }
    }
    
    // Return participants that appear in at least 50% of expenses
    const threshold = expenses.length * 0.5;
    return Object.entries(participantCounts)
        .filter(([_, count]) => count >= threshold)
        .map(([participant]) => participant);
}

export async function createRecurringReminder(
    pattern: RecurringPattern | RecurringPattern[],
    options: ReminderOptions = {}
): Promise<string> {
    const { suggestTemplate = false, includeQuickActions = false, batchReminders = false } = options;

    // Handle batch reminders
    if (Array.isArray(pattern) && batchReminders) {
        const total = pattern.reduce((sum, p) => sum + p.amount, 0);
        let reminder = `📅 <b>Upcoming Recurring Expenses</b>\n\n`;
        reminder += `You have ${pattern.length} recurring expenses coming up:\n\n`;
        
        for (const p of pattern) {
            reminder += `• <b>${p.description}</b> - $${p.amount.toFixed(2)} (${p.frequency})\n`;
        }
        
        reminder += `\n<b>Total:</b> $${total.toFixed(2)}`;
        
        if (suggestTemplate) {
            reminder += '\n\n💡 Tip: Create templates for these recurring expenses with /templates';
        }
        
        return reminder;
    }

    // Single pattern reminder
    const p = Array.isArray(pattern) ? pattern[0] : pattern;
    
    const dateStr = formatDate(p.nextExpectedDate, p.frequency);
    let reminder = `🔔 <b>Recurring Expense Reminder</b>\n\n`;
    reminder += `Your ${p.frequency} <b>${p.description}</b> expense is coming up ${dateStr}.\n`;
    reminder += `Expected amount: <b>$${p.averageAmount.toFixed(2)}</b>`;
    
    if (p.participants && p.participants.length > 0) {
        reminder += `\nUsually split with: ${p.participants.join(', ')}`;
    }
    
    if (includeQuickActions) {
        reminder += `\n\n<b>Quick actions:</b>`;
        reminder += `\n• Add expense: <code>/add ${p.averageAmount.toFixed(2)} ${p.description}</code>`;
        
        if (suggestTemplate && p.confidence > 0.85) {
            reminder += `\n• Create template: <code>/templates create "${p.description}" ${p.averageAmount}</code>`;
        }
    } else if (suggestTemplate) {
        reminder += `\n\n💡 Create a template for this recurring expense with /templates`;
    }
    
    return reminder;
}

function formatDate(date: Date, frequency: string): string {
    const today = new Date();
    const tomorrow = addDays(today, 1);
    
    if (date.toDateString() === today.toDateString()) {
        return 'today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
        return 'tomorrow';
    } else if (frequency === 'daily') {
        return `on ${format(date, 'EEEE')}`;
    } else if (frequency === 'weekly') {
        return `this ${format(date, 'EEEE')}`;
    } else {
        return `on ${format(date, 'MMMM d')}`;
    }
}