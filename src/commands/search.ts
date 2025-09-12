import { Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { reply } from '../utils/reply';
import { formatCurrency } from '../utils/currency';
import { format } from 'date-fns';

interface SearchParams {
    query?: string;
    minAmount?: number;
    maxAmount?: number;
    username?: string;
    dateFrom?: Date;
    dateTo?: Date;
}

function parseSearchQuery(args: string[]): SearchParams {
    const params: SearchParams = {};
    const queryParts: string[] = [];
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        // Check for amount range
        const rangeMatch = arg.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
        if (rangeMatch) {
            params.minAmount = parseFloat(rangeMatch[1]);
            params.maxAmount = parseFloat(rangeMatch[2]);
        } 
        // Check for greater than
        else if (arg[0] === '>') {
            const amount = parseFloat(arg.substring(1));
            if (!isNaN(amount)) params.minAmount = amount;
        }
        // Check for less than
        else if (arg[0] === '<') {
            const amount = parseFloat(arg.substring(1));
            if (!isNaN(amount)) params.maxAmount = amount;
        }
        // Check for username
        else if (arg.startsWith('@')) {
            params.username = arg.substring(1);
        }
        // Check for date keywords
        else if (arg === 'today') {
            params.dateFrom = new Date();
            params.dateFrom.setHours(0, 0, 0, 0);
        }
        else if (arg === 'yesterday') {
            const date = new Date();
            date.setDate(date.getDate() - 1);
            date.setHours(0, 0, 0, 0);
            params.dateFrom = date;
            params.dateTo = new Date(date.getTime());
            params.dateTo.setHours(23, 59, 59, 999);
        }
        else if (arg === 'last' && args[i + 1] === 'week') {
            params.dateFrom = new Date();
            params.dateFrom.setDate(params.dateFrom.getDate() - 7);
            i++; // Skip 'week'
        }
        else if (arg === 'last' && args[i + 1] === 'month') {
            params.dateFrom = new Date();
            params.dateFrom.setMonth(params.dateFrom.getMonth() - 1);
            i++; // Skip 'month'
        }
        else {
            queryParts.push(arg);
        }
    }
    
    if (queryParts.length > 0) {
        params.query = queryParts.join(' ');
    }
    
    return params;
}

export async function handleSearch(ctx: Context, db: D1Database) {
    const isPersonal = ctx.chat?.type === 'private';
    const userId = ctx.from?.id.toString();
    const groupId = ctx.chat?.id.toString();
    
    const text = ctx.message?.text || '';
    const args = text.split(' ').slice(1);
    
    if (args.length === 0) {
        await reply(ctx, 
            '🔍 <b>Search Expenses</b>\n\n' +
            'Usage: /search [query] [filters]\n\n' +
            'Examples:\n' +
            '• <code>/search lunch</code> - Find "lunch" expenses\n' +
            '• <code>/search >50</code> - Expenses over $50\n' +
            '• <code>/search 20-100</code> - Between $20-$100\n' +
            '• <code>/search @john</code> - Expenses with John\n' +
            '• <code>/search coffee last week</code> - Coffee last week\n' +
            '• <code>/search yesterday</code> - Yesterday\'s expenses',
            { parse_mode: 'HTML' }
        );
        return;
    }
    
    const params = parseSearchQuery(args);
    
    try {
        // Build the query with cleaner structure
        const conditions: string[] = ['e.deleted = FALSE'];
        const bindings: any[] = [];
        
        // Add context filter
        if (isPersonal) {
            conditions.push('e.is_personal = TRUE');
            conditions.push('e.created_by = ?');
            bindings.push(userId);
        } else {
            conditions.push('e.group_id = ?');
            bindings.push(groupId);
        }
        
        // Add search filters
        if (params.query) {
            conditions.push('(e.description LIKE ? OR e.notes LIKE ?)');
            const searchPattern = `%${params.query}%`;
            bindings.push(searchPattern, searchPattern);
        }
        
        if (params.minAmount !== undefined) {
            conditions.push('e.amount >= ?');
            bindings.push(params.minAmount);
        }
        
        if (params.maxAmount !== undefined) {
            conditions.push('e.amount <= ?');
            bindings.push(params.maxAmount);
        }
        
        if (params.username && !isPersonal) {
            conditions.push(`(u.username = ? OR EXISTS (
                SELECT 1 FROM expense_splits es 
                JOIN users u2 ON es.user_id = u2.telegram_id 
                WHERE es.expense_id = e.id AND u2.username = ?
            ))`);
            bindings.push(params.username, params.username);
        }
        
        if (params.dateFrom) {
            conditions.push('e.created_at >= ?');
            bindings.push(params.dateFrom.toISOString());
        }
        
        if (params.dateTo) {
            conditions.push('e.created_at <= ?');
            bindings.push(params.dateTo.toISOString());
        }
        
        const query = `
            SELECT 
                e.id,
                e.amount,
                e.description,
                e.category,
                e.notes,
                e.created_at,
                e.paid_by,
                u.username as payer_username,
                u.first_name as payer_first_name
                ${!isPersonal ? `,
                (SELECT COUNT(*) FROM expense_splits WHERE expense_id = e.id) as split_count,
                (SELECT GROUP_CONCAT(u2.username) FROM expense_splits es JOIN users u2 ON es.user_id = u2.telegram_id WHERE es.expense_id = e.id) as participants` : ''}
            FROM expenses e
            JOIN users u ON e.paid_by = u.telegram_id
            WHERE ${conditions.join(' AND ')}
            ORDER BY e.created_at DESC 
            LIMIT 20
        `;
        
        // Execute search
        const results = await db.prepare(query).bind(...bindings).all();
        
        if (!results.results || results.results.length === 0) {
            await reply(ctx, '🔍 No expenses found matching your search.');
            return;
        }
        
        // Format results
        let message = `🔍 <b>Search Results (${results.results.length})</b>\n\n`;
        
        // Show search criteria
        const criteria: string[] = [];
        if (params.query) criteria.push(`"${params.query}"`);
        if (params.minAmount !== undefined && params.maxAmount !== undefined) {
            criteria.push(`$${params.minAmount}-$${params.maxAmount}`);
        } else if (params.minAmount !== undefined) {
            criteria.push(`>$${params.minAmount}`);
        } else if (params.maxAmount !== undefined) {
            criteria.push(`<$${params.maxAmount}`);
        }
        if (params.username) criteria.push(`@${params.username}`);
        if (params.dateFrom || params.dateTo) {
            if (args.includes('yesterday')) {
                criteria.push('yesterday');
            } else if (args.includes('today')) {
                criteria.push('today');
            } else if (args.includes('last')) {
                criteria.push(args.slice(args.indexOf('last')).join(' '));
            }
        }
        
        if (criteria.length > 0) {
            message += `<i>Searching for: ${criteria.join(', ')}</i>\n\n`;
        }
        
        // Display results
        let totalAmount = 0;
        results.results.forEach((expense: any, idx: number) => {
            const amount = expense.amount as number;
            totalAmount += amount;
            const date = new Date(expense.created_at as string);
            const payerName = expense.payer_username || expense.payer_first_name || 'Unknown';
            
            message += `${idx + 1}. <b>${formatCurrency(amount, 'USD')}</b> - ${expense.description}\n`;
            if (expense.notes) {
                message += `   💬 ${expense.notes}\n`;
            }
            message += `   👤 @${payerName} • 📅 ${format(date, 'MMM d')}\n`;
            if (!isPersonal && expense.split_count) {
                message += `   👥 Split: ${expense.split_count} people\n`;
            }
            message += `   /view_${expense.id}\n\n`;
        });
        
        message += `<b>Total: ${formatCurrency(totalAmount, 'USD')}</b>`;
        
        await reply(ctx, message, { 
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔍 New Search', callback_data: 'search_help' }],
                    [{ text: '❌ Close', callback_data: 'close' }]
                ]
            }
        });
        
    } catch (error) {
        console.error('Search error:', error);
        await reply(ctx, '❌ Error searching expenses. Please try again.');
    }
}