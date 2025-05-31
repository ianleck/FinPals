import { describe, it, expect, beforeEach, vi } from 'vitest';
import { suggestParticipants } from '../../utils/participant-suggestions';
import { createTestDatabase } from '../helpers/test-utils';

describe('Participant Suggestions', () => {
    let db: D1Database;

    beforeEach(() => {
        db = createTestDatabase();
        vi.clearAllMocks();
    });

    describe('suggestParticipants', () => {
        it('should suggest participants based on similar expense descriptions', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Create a queue of responses for the sequential calls
            const mockResponses = [
                // First call: exact match query
                { results: [
                    { user_id: 'user1', count: 5 },
                    { user_id: 'user2', count: 3 },
                    { user_id: 'user3', count: 2 },
                ]},
                // Second call: active members check
                { results: [
                    { user_id: 'user1' },
                    { user_id: 'user2' },
                    { user_id: 'user3' },
                ]}
            ];
            
            let callIndex = 0;
            mockStmt.all.mockImplementation(() => {
                const response = mockResponses[callIndex];
                callIndex++;
                return Promise.resolve(response);
            });

            const suggestions = await suggestParticipants(db, 'group123', 'lunch with team', 'payer123');
            
            expect(suggestions).toHaveLength(3);
            expect(suggestions[0]).toBe('user1'); // Most frequent participant
            expect(suggestions[1]).toBe('user2');
            expect(suggestions[2]).toBe('user3');
        });

        it('should exclude the payer from suggestions', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            const mockResponses = [
                // First call: exact match query (payer is excluded in WHERE clause)
                { results: [
                    { user_id: 'user1', count: 5 },
                    { user_id: 'user2', count: 3 },
                ]},
                // Second call: active members check
                { results: [
                    { user_id: 'user1' },
                    { user_id: 'user2' },
                ]}
            ];
            
            let callIndex = 0;
            mockStmt.all.mockImplementation(() => {
                const response = mockResponses[callIndex];
                callIndex++;
                return Promise.resolve(response);
            });

            const suggestions = await suggestParticipants(db, 'group123', 'dinner', 'payer123');
            
            expect(suggestions).not.toContain('payer123');
            expect(suggestions).toHaveLength(2);
        });

        it('should suggest participants for recurring expenses at similar times', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            const mockResponses = [
                // First call: exact match (no results)
                { results: [] },
                // Second call: partial match with 'coffee'
                { results: [
                    { user_id: 'user1', count: 2 },
                ]},
                // Third call: time-based suggestions
                { results: [
                    { user_id: 'user2', count: 5 },
                    { user_id: 'user3', count: 3 },
                ]},
                // Fourth call: active members check
                { results: [
                    { user_id: 'user1' },
                    { user_id: 'user2' },
                    { user_id: 'user3' },
                ]}
            ];
            
            let callIndex = 0;
            mockStmt.all.mockImplementation(() => {
                const response = mockResponses[callIndex];
                callIndex++;
                return Promise.resolve(response);
            });

            const suggestions = await suggestParticipants(
                db, 
                'group123', 
                'coffee', 
                'payer123',
                { considerTime: true }
            );
            
            // Should combine both suggestion types
            expect(suggestions.length).toBeGreaterThan(0);
            expect(suggestions).toContain('user1'); // From description match
            expect(suggestions).toContain('user2'); // From time match
        });

        it('should limit suggestions to active group members only', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            // Reset the mock first to ensure clean state
            mockStmt.all.mockReset();
            
            // The function makes 3 calls: exact match, partial match (maybe), and active members check
            mockStmt.all
                .mockResolvedValueOnce({
                    // First call: exact match including inactive user
                    results: [
                        { user_id: 'user1', count: 5 },
                        { user_id: 'inactive_user', count: 10 },
                        { user_id: 'user2', count: 3 },
                    ]
                })
                .mockResolvedValueOnce({
                    // Second call: partial match query (no new results)
                    results: []
                })
                .mockResolvedValueOnce({
                    // Third call: active members check (inactive_user excluded)
                    results: [
                        { user_id: 'user1' },
                        { user_id: 'user2' },
                    ]
                });

            const suggestions = await suggestParticipants(db, 'group123', 'lunch', 'payer123');
            
            expect(suggestions).not.toContain('inactive_user');
            expect(suggestions).toContain('user1');
            expect(suggestions).toContain('user2');
        });

        it('should return empty array when no historical data exists', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            mockStmt.all.mockImplementation(() => {
                return Promise.resolve({ results: [] });
            });

            const suggestions = await suggestParticipants(db, 'group123', 'first expense ever', 'payer123');
            
            expect(suggestions).toEqual([]);
        });

        it('should prioritize exact description matches over partial matches', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            const mockResponses = [
                // First call: exact match for "team lunch"
                { results: [
                    { user_id: 'user1', count: 3 },
                    { user_id: 'user2', count: 2 },
                ]},
                // Second call: partial match for "team"
                { results: [
                    { user_id: 'user3', count: 5 },  // Lower than exact match weighted scores
                ]},
                // Third call: active members check
                { results: [
                    { user_id: 'user1' },
                    { user_id: 'user2' },
                    { user_id: 'user3' },
                ]}
            ];
            
            let callIndex = 0;
            mockStmt.all.mockImplementation(() => {
                const response = mockResponses[callIndex];
                callIndex++;
                return Promise.resolve(response);
            });

            const suggestions = await suggestParticipants(
                db, 
                'group123', 
                'team lunch', 
                'payer123',
                { maxSuggestions: 3 }
            );
            
            // Exact matches should come first
            expect(suggestions[0]).toBe('user1');
            expect(suggestions[1]).toBe('user2');
            expect(suggestions[2]).toBe('user3'); // Best partial match
        });

        it('should handle emoji-based descriptions intelligently', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            const mockResponses = [
                // First call: exact match (no results)
                { results: [] },
                // Second call: partial match for "pizza"
                { results: [
                    { user_id: 'user1', count: 5 },
                    { user_id: 'user2', count: 3 },
                ]},
                // Third call: active members check
                { results: [
                    { user_id: 'user1' },
                    { user_id: 'user2' },
                ]}
            ];
            
            let callIndex = 0;
            mockStmt.all.mockImplementation(() => {
                const response = mockResponses[callIndex];
                callIndex++;
                return Promise.resolve(response);
            });

            const suggestions = await suggestParticipants(db, 'group123', '🍕 pizza night', 'payer123');
            
            expect(suggestions).toHaveLength(2);
            expect(suggestions).toContain('user1');
            expect(suggestions).toContain('user2');
        });

        it('should respect maxSuggestions parameter', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            const mockResponses = [
                // First call: exact match with many results
                { results: [
                    { user_id: 'user1', count: 10 },
                    { user_id: 'user2', count: 8 },
                    { user_id: 'user3', count: 6 },
                    { user_id: 'user4', count: 4 },
                    { user_id: 'user5', count: 2 },
                ]},
                // Second call: active members check
                { results: [
                    { user_id: 'user1' },
                    { user_id: 'user2' },
                    { user_id: 'user3' },
                    { user_id: 'user4' },
                    { user_id: 'user5' },
                ]}
            ];
            
            let callIndex = 0;
            mockStmt.all.mockImplementation(() => {
                const response = mockResponses[callIndex];
                callIndex++;
                return Promise.resolve(response);
            });

            const suggestions = await suggestParticipants(
                db, 
                'group123', 
                'dinner', 
                'payer123',
                { maxSuggestions: 3 }
            );
            
            expect(suggestions).toHaveLength(3);
            expect(suggestions).toEqual(['user1', 'user2', 'user3']);
        });
    });

    describe('UX-focused behavior', () => {
        it('should provide helpful context when returning suggestions', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            const mockResponses = [
                // First call: exact match
                { results: [
                    { user_id: 'user1', count: 5 },
                    { user_id: 'user2', count: 3 },
                ]},
                // Second call: active members check
                { results: [
                    { user_id: 'user1' },
                    { user_id: 'user2' },
                ]}
            ];
            
            let callIndex = 0;
            mockStmt.all.mockImplementation(() => {
                const response = mockResponses[callIndex];
                callIndex++;
                return Promise.resolve(response);
            });

            const result = await suggestParticipants(
                db, 
                'group123', 
                'lunch', 
                'payer123',
                { includeContext: true }
            );
            
            // When includeContext is true, should return rich objects
            expect(result).toMatchObject({
                suggestions: ['user1', 'user2'],
                context: {
                    basedOn: 'similar expenses',
                    confidence: expect.any(String), // 'high', 'medium', 'low'
                    message: expect.any(String)
                }
            });
        });

        it('should handle typos and variations in descriptions', async () => {
            const mockStmt = (db as any)._getMockStatement();
            
            const mockResponses = [
                // First call: exact match (no results due to typo)
                { results: [] },
                // Second call: partial match for "lnch"
                { results: [
                    { user_id: 'user1', count: 3 },
                ]},
                // Third call: active members check
                { results: [
                    { user_id: 'user1' },
                ]}
            ];
            
            let callIndex = 0;
            mockStmt.all.mockImplementation(() => {
                const response = mockResponses[callIndex];
                callIndex++;
                return Promise.resolve(response);
            });

            const suggestions = await suggestParticipants(
                db, 
                'group123', 
                'lnch with team', // Typo
                'payer123',
                { fuzzyMatch: true }
            );
            
            expect(suggestions.length).toBeGreaterThan(0);
        });
    });
});