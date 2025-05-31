import type { D1Database } from '@cloudflare/workers-types';
import { formatCurrency } from './currency';

interface SpendingTrend {
    period: string;
    total: number;
    categoryBreakdown: { [category: string]: number };
    change: number; // Percentage change from previous period
}

interface CategoryTrend {
    category: string;
    current: number;
    previous: number;
    change: number;
    percentage: number;
}

export async function generateSpendingTrends(
    db: D1Database,
    groupId: string,
    userId?: string,
    months: number = 3
): Promise<{
    trends: SpendingTrend[];
    categoryTrends: CategoryTrend[];
    insights: string[];
}> {
    const trends: SpendingTrend[] = [];
    const endDate = new Date();
    
    // Build date ranges for batch query
    const dateRanges: { start: Date; end: Date; period: string }[] = [];
    for (let i = 0; i < months; i++) {
        const start = new Date(endDate.getFullYear(), endDate.getMonth() - i, 1);
        const end = new Date(endDate.getFullYear(), endDate.getMonth() - i + 1, 0);
        dateRanges.push({
            start,
            end,
            period: start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
        });
    }
    
    // Single query to get all data
    const query = userId
        ? `SELECT 
            strftime('%Y-%m', created_at) as month,
            SUM(amount) as total,
            category,
            COUNT(*) as count
           FROM expenses 
           WHERE group_id = ? 
             AND paid_by = ?
             AND deleted = FALSE 
             AND created_at >= ?
           GROUP BY month, category`
        : `SELECT 
            strftime('%Y-%m', created_at) as month,
            SUM(amount) as total,
            category,
            COUNT(*) as count
           FROM expenses 
           WHERE group_id = ? 
             AND deleted = FALSE 
             AND created_at >= ?
           GROUP BY month, category`;
    
    const oldestDate = dateRanges[dateRanges.length - 1].start;
    const params = userId 
        ? [groupId, userId, oldestDate.toISOString()]
        : [groupId, oldestDate.toISOString()];
    
    const result = await db.prepare(query).bind(...params).all();
    
    // Process results into monthly trends
    const monthlyData = new Map<string, { total: number; categories: { [key: string]: number } }>();
    
    for (const row of result.results) {
        const month = row.month as string;
        const category = row.category as string || 'Uncategorized';
        const amount = row.total as number;
        
        if (!monthlyData.has(month)) {
            monthlyData.set(month, { total: 0, categories: {} });
        }
        
        const data = monthlyData.get(month)!;
        data.categories[category] = amount;
        data.total += amount;
    }
    
    // Build trends from date ranges
    for (const range of dateRanges) {
        const monthKey = `${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, '0')}`;
        const data = monthlyData.get(monthKey) || { total: 0, categories: {} };
        
        trends.push({
            period: range.period,
            total: data.total,
            categoryBreakdown: data.categories,
            change: 0
        });
    }
    
    // Calculate month-over-month changes
    for (let i = 0; i < trends.length - 1; i++) {
        const current = trends[i].total;
        const previous = trends[i + 1].total;
        trends[i].change = previous > 0 ? ((current - previous) / previous) * 100 : 0;
    }
    
    // Generate category trends
    const categoryTrends = await generateCategoryTrends(db, groupId, userId);
    
    // Generate insights
    const insights = generateInsights(trends, categoryTrends);
    
    return { trends: trends.reverse(), categoryTrends, insights };
}

async function generateCategoryTrends(
    db: D1Database,
    groupId: string,
    userId?: string
): Promise<CategoryTrend[]> {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    
    // Get current month data
    const currentQuery = userId
        ? `SELECT category, SUM(amount) as total
           FROM expenses 
           WHERE group_id = ? AND paid_by = ? AND deleted = FALSE 
             AND created_at >= ?
           GROUP BY category`
        : `SELECT category, SUM(amount) as total
           FROM expenses 
           WHERE group_id = ? AND deleted = FALSE 
             AND created_at >= ?
           GROUP BY category`;
    
    const currentParams = userId 
        ? [groupId, userId, thisMonthStart.toISOString()]
        : [groupId, thisMonthStart.toISOString()];
    
    const currentData = await db.prepare(currentQuery).bind(...currentParams).all();
    
    // Get last month data
    const previousQuery = userId
        ? `SELECT category, SUM(amount) as total
           FROM expenses 
           WHERE group_id = ? AND paid_by = ? AND deleted = FALSE 
             AND created_at >= ? AND created_at <= ?
           GROUP BY category`
        : `SELECT category, SUM(amount) as total
           FROM expenses 
           WHERE group_id = ? AND deleted = FALSE 
             AND created_at >= ? AND created_at <= ?
           GROUP BY category`;
    
    const previousParams = userId
        ? [groupId, userId, lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
        : [groupId, lastMonthStart.toISOString(), lastMonthEnd.toISOString()];
    
    const previousData = await db.prepare(previousQuery).bind(...previousParams).all();
    
    // Build maps
    const currentMap = new Map<string, number>();
    const previousMap = new Map<string, number>();
    
    currentData.results.forEach(row => {
        currentMap.set(row.category as string || 'Uncategorized', row.total as number);
    });
    
    previousData.results.forEach(row => {
        previousMap.set(row.category as string || 'Uncategorized', row.total as number);
    });
    
    // Calculate trends
    const trends: CategoryTrend[] = [];
    const allCategories = new Set([...currentMap.keys(), ...previousMap.keys()]);
    
    allCategories.forEach(category => {
        const current = currentMap.get(category) || 0;
        const previous = previousMap.get(category) || 0;
        const change = current - previous;
        const percentage = previous > 0 ? (change / previous) * 100 : (current > 0 ? 100 : 0);
        
        trends.push({ category, current, previous, change, percentage });
    });
    
    // Sort by current amount descending
    return trends.sort((a, b) => b.current - a.current);
}

function generateInsights(trends: SpendingTrend[], categoryTrends: CategoryTrend[]): string[] {
    const insights: string[] = [];
    
    // Overall spending trend
    if (trends.length >= 2) {
        const latestTrend = trends[trends.length - 1];
        if (latestTrend.change > 20) {
            insights.push(`📈 Spending increased by ${Math.abs(latestTrend.change).toFixed(0)}% this month`);
        } else if (latestTrend.change < -20) {
            insights.push(`📉 Great job! Spending decreased by ${Math.abs(latestTrend.change).toFixed(0)}% this month`);
        }
    }
    
    // Highest spending category
    const topCategory = categoryTrends[0];
    if (topCategory && topCategory.current > 0) {
        insights.push(`🏆 Highest spending: ${topCategory.category} ($${topCategory.current.toFixed(2)})`);
    }
    
    // Fastest growing category
    const fastestGrowing = categoryTrends
        .filter(ct => ct.percentage > 50 && ct.current > 20)
        .sort((a, b) => b.percentage - a.percentage)[0];
    
    if (fastestGrowing) {
        insights.push(`⚡ ${fastestGrowing.category} spending up ${fastestGrowing.percentage.toFixed(0)}%`);
    }
    
    // Category reduction
    const biggestReduction = categoryTrends
        .filter(ct => ct.percentage < -30 && ct.previous > 20)
        .sort((a, b) => a.percentage - b.percentage)[0];
    
    if (biggestReduction) {
        insights.push(`💰 ${biggestReduction.category} spending down ${Math.abs(biggestReduction.percentage).toFixed(0)}%`);
    }
    
    return insights;
}

export function formatTrendsMessage(
    trends: SpendingTrend[],
    categoryTrends: CategoryTrend[],
    insights: string[]
): string {
    let message = '📊 <b>Spending Trends</b>\n\n';
    
    // Monthly overview
    message += '<b>Monthly Overview:</b>\n';
    trends.forEach(trend => {
        const changeIcon = trend.change > 0 ? '📈' : trend.change < 0 ? '📉' : '➡️';
        const changeText = trend.change !== 0 
            ? ` (${trend.change > 0 ? '+' : ''}${trend.change.toFixed(0)}%)`
            : '';
        message += `${changeIcon} ${trend.period}: ${formatCurrency(trend.total, 'USD')}${changeText}\n`;
    });
    
    // Category breakdown for current month
    if (categoryTrends.length > 0) {
        message += '\n<b>Category Trends (This Month):</b>\n';
        categoryTrends.slice(0, 5).forEach(ct => {
            if (ct.current > 0) {
                const changeIcon = ct.change > 0 ? '↗️' : ct.change < 0 ? '↘️' : '→';
                message += `${changeIcon} ${ct.category}: ${formatCurrency(ct.current, 'USD')}`;
                if (ct.previous > 0) {
                    message += ` (${ct.percentage > 0 ? '+' : ''}${ct.percentage.toFixed(0)}%)`;
                }
                message += '\n';
            }
        });
    }
    
    // Insights
    if (insights.length > 0) {
        message += '\n<b>Insights:</b>\n';
        insights.forEach(insight => {
            message += `${insight}\n`;
        });
    }
    
    // Visual bar chart for top categories
    if (categoryTrends.length > 0) {
        const maxAmount = Math.max(...categoryTrends.map(ct => ct.current));
        message += '\n<b>Top Categories:</b>\n';
        categoryTrends.slice(0, 3).forEach(ct => {
            if (ct.current > 0) {
                const barLength = Math.round((ct.current / maxAmount) * 10);
                const bar = '█'.repeat(barLength) + '░'.repeat(10 - barLength);
                message += `${ct.category}\n${bar} ${formatCurrency(ct.current, 'USD')}\n`;
            }
        });
    }
    
    return message;
}