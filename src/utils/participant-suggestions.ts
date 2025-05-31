import type { D1Database } from '@cloudflare/workers-types';

export interface SuggestionOptions {
    maxSuggestions?: number;
    considerTime?: boolean;
    includeContext?: boolean;
    fuzzyMatch?: boolean;
}

export interface SuggestionResult {
    suggestions: string[];
    context: {
        basedOn: string;
        confidence: 'high' | 'medium' | 'low';
        message: string;
    };
}

/**
 * Suggests participants for an expense based on historical data
 * Prioritizes UX by providing intelligent, context-aware suggestions
 */
export async function suggestParticipants(
    db: D1Database,
    groupId: string,
    description: string,
    payerId: string,
    options: SuggestionOptions = {}
): Promise<string[] | SuggestionResult> {
    const {
        maxSuggestions = 5,
        considerTime = false,
        includeContext = false,
        fuzzyMatch = false
    } = options;

    const suggestions: Map<string, number> = new Map();
    let basedOn = 'similar expenses';
    let totalMatches = 0;

    // Clean description for better matching
    const cleanDesc = description.toLowerCase().trim();
    const words = cleanDesc.split(/\s+/).filter(w => w.length > 2);
    
    // Extract main keyword (skip common words)
    const commonWords = ['with', 'for', 'and', 'the', 'our', 'team'];
    const keywords = words.filter(w => !commonWords.includes(w));
    const mainKeyword = keywords[0] || words[0] || '';

    try {
        // 1. Find participants from similar expenses (exact match first)
        const exactMatchQuery = `
            SELECT es.user_id, COUNT(*) as count
            FROM expenses e
            JOIN expense_splits es ON e.id = es.expense_id
            WHERE e.group_id = ?
                AND e.deleted = FALSE
                AND es.user_id != ?
                AND LOWER(e.description) = ?
                AND e.created_at > datetime('now', '-90 days')
            GROUP BY es.user_id
            ORDER BY count DESC
            LIMIT 10
        `;

        const exactMatchResult = await db
            .prepare(exactMatchQuery)
            .bind(groupId, payerId, cleanDesc)
            .all();

        // Add exact matches with higher weight
        if (exactMatchResult && exactMatchResult.results) {
            for (const match of exactMatchResult.results) {
                suggestions.set(match.user_id as string, (match.count as number) * 3);
                totalMatches += match.count as number;
            }
        }

        // 2. Find participants from partial matches if needed
        if (suggestions.size < maxSuggestions && mainKeyword) {
            const partialMatchQuery = `
                SELECT es.user_id, COUNT(*) as count
                FROM expenses e
                JOIN expense_splits es ON e.id = es.expense_id
                WHERE e.group_id = ?
                    AND e.deleted = FALSE
                    AND es.user_id != ?
                    AND es.user_id NOT IN (${Array.from(suggestions.keys()).map(() => '?').join(',') || "''"})
                    AND LOWER(e.description) LIKE ?
                    AND e.created_at > datetime('now', '-90 days')
                GROUP BY es.user_id
                ORDER BY count DESC
                LIMIT ?
            `;

            const bindings = [
                groupId, 
                payerId,
                ...Array.from(suggestions.keys()),
                `%${mainKeyword}%`,
                maxSuggestions - suggestions.size
            ];

            const partialMatchResult = await db
                .prepare(partialMatchQuery)
                .bind(...bindings)
                .all();

            if (partialMatchResult && partialMatchResult.results) {
                for (const match of partialMatchResult.results) {
                    const currentScore = suggestions.get(match.user_id as string) || 0;
                    suggestions.set(match.user_id as string, currentScore + (match.count as number));
                    totalMatches += match.count as number;
                }
            }
        }

        // 3. Consider time-based patterns if enabled
        if (considerTime && suggestions.size < maxSuggestions) {
            const currentHour = new Date().getHours();
            const timeWindowStart = (currentHour - 1 + 24) % 24;
            const timeWindowEnd = (currentHour + 1) % 24;

            const timeBasedQuery = `
                SELECT es.user_id, COUNT(*) as count
                FROM expenses e
                JOIN expense_splits es ON e.id = es.expense_id
                WHERE e.group_id = ?
                    AND e.deleted = FALSE
                    AND es.user_id != ?
                    AND es.user_id NOT IN (${Array.from(suggestions.keys()).map(() => '?').join(',') || "''"})
                    AND CAST(strftime('%H', e.created_at) AS INTEGER) BETWEEN ? AND ?
                    AND e.created_at > datetime('now', '-30 days')
                GROUP BY es.user_id
                ORDER BY count DESC
                LIMIT ?
            `;

            const timeBindings = [
                groupId,
                payerId,
                ...Array.from(suggestions.keys()),
                timeWindowStart,
                timeWindowEnd,
                maxSuggestions - suggestions.size
            ];

            const timeMatchResult = await db
                .prepare(timeBasedQuery)
                .bind(...timeBindings)
                .all();

            if (timeMatchResult && timeMatchResult.results && timeMatchResult.results.length > 0) {
                basedOn = 'similar expenses and time patterns';
                for (const match of timeMatchResult.results) {
                    const currentScore = suggestions.get(match.user_id as string) || 0;
                    suggestions.set(match.user_id as string, currentScore + (match.count as number) * 0.5);
                    totalMatches += match.count as number;
                }
            }
        }

        // 4. Filter to only active group members
        if (suggestions.size > 0) {
            const memberCheckQuery = `
                SELECT user_id 
                FROM group_members 
                WHERE group_id = ? 
                    AND user_id IN (${Array.from(suggestions.keys()).map(() => '?').join(',')})
                    AND active = TRUE
            `;

            const activeMemberResult = await db
                .prepare(memberCheckQuery)
                .bind(groupId, ...Array.from(suggestions.keys()))
                .all();

            if (activeMemberResult && activeMemberResult.results) {
                const activeMemberIds = new Set(activeMemberResult.results.map(m => m.user_id as string));
                
                // Remove inactive members
                for (const userId of Array.from(suggestions.keys())) {
                    if (!activeMemberIds.has(userId)) {
                        suggestions.delete(userId);
                    }
                }
            }
        }

        // Sort by score and limit
        const sortedSuggestions = Array.from(suggestions.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, maxSuggestions)
            .map(([userId]) => userId);

        // Determine confidence level based on match count
        let confidence: 'high' | 'medium' | 'low' = 'low';
        if (totalMatches > 5 && sortedSuggestions.length >= 2) {
            confidence = 'high';
        } else if (totalMatches > 2 && sortedSuggestions.length >= 1) {
            confidence = 'medium';
        }

        // Generate helpful message
        let message = '';
        if (sortedSuggestions.length > 0) {
            if (confidence === 'high') {
                message = `Based on ${totalMatches} similar expenses, these people usually join`;
            } else if (confidence === 'medium') {
                message = `Based on recent patterns, you might want to include`;
            } else {
                message = `Found a few people who occasionally join similar expenses`;
            }
        } else {
            message = 'No suggestions available - this seems to be a new type of expense';
        }

        if (includeContext) {
            return {
                suggestions: sortedSuggestions,
                context: {
                    basedOn,
                    confidence,
                    message
                }
            };
        }

        return sortedSuggestions;

    } catch (error) {
        console.error('Error in suggestParticipants:', error);
        // Return empty suggestions on error - don't break the main flow
        if (includeContext) {
            return {
                suggestions: [],
                context: {
                    basedOn: 'error',
                    confidence: 'low',
                    message: 'Unable to load suggestions at this time'
                }
            };
        }
        return [];
    }
}