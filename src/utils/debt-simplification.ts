import type { Database } from '../db';
import { sql } from 'drizzle-orm';
import { toResultArray } from './db-helpers';

interface Balance {
    userId: string;
    amount: number;
    userName?: string;
}

interface Transaction {
    from: string;
    to: string;
    amount: number;
    fromName?: string;
    toName?: string;
}

/**
 * Simplifies debts within a group to minimize the number of transactions needed
 * Uses a greedy algorithm to match creditors and debtors
 */
export async function simplifyDebts(
    db: Database,
    groupId: string,
    tripId?: string
): Promise<Transaction[]> {
    // Get all balances for the group
    const balances = await calculateNetBalances(db, groupId, tripId);
    
    // Separate creditors (positive balance) and debtors (negative balance)
    const creditors: Balance[] = [];
    const debtors: Balance[] = [];
    
    for (const balance of balances) {
        if (balance.amount > 0.01) { // Small epsilon to handle floating point
            creditors.push(balance);
        } else if (balance.amount < -0.01) {
            debtors.push({ ...balance, amount: Math.abs(balance.amount) });
        }
    }
    
    // Sort both arrays in descending order of amount
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);
    
    const transactions: Transaction[] = [];
    let i = 0, j = 0;
    
    // Greedy algorithm to minimize transactions
    while (i < creditors.length && j < debtors.length) {
        const creditor = creditors[i];
        const debtor = debtors[j];
        
        const amount = Math.min(creditor.amount, debtor.amount);
        
        if (amount > 0.01) { // Only create transaction if meaningful amount
            transactions.push({
                from: debtor.userId,
                to: creditor.userId,
                amount: Number(amount.toFixed(2)),
                fromName: debtor.userName,
                toName: creditor.userName
            });
        }
        
        creditor.amount -= amount;
        debtor.amount -= amount;
        
        // Move to next creditor/debtor if current one is settled
        if (creditor.amount < 0.01) i++;
        if (debtor.amount < 0.01) j++;
    }
    
    return transactions;
}

/**
 * Calculate net balances for all users in a group
 */
async function calculateNetBalances(
    db: Database,
    groupId: string,
    tripId?: string
): Promise<Balance[]> {
    // Get all expenses and settlements
    const result = await db.execute(sql`
        WITH expense_balances AS (
            -- Money paid by each user
            SELECT 
                e.paid_by as user_id,
                SUM(e.amount) as paid_amount,
                0 as owed_amount,
                0 as settlement_paid,
                0 as settlement_received
            FROM expenses e
            WHERE e.group_id = ${groupId} 
                AND e.deleted = FALSE
                ${tripId ? sql`AND e.trip_id = ${tripId}` : sql``}
            GROUP BY e.paid_by
            
            UNION ALL
            
            -- Money owed by each user
            SELECT 
                es.user_id,
                0 as paid_amount,
                SUM(es.amount) as owed_amount,
                0 as settlement_paid,
                0 as settlement_received
            FROM expense_splits es
            JOIN expenses e ON es.expense_id = e.id
            WHERE e.group_id = ${groupId} 
                AND e.deleted = FALSE
                ${tripId ? sql`AND e.trip_id = ${tripId}` : sql``}
            GROUP BY es.user_id
        ),
        settlement_balances AS (
            -- Money paid in settlements
            SELECT 
                s.from_user as user_id,
                0 as paid_amount,
                0 as owed_amount,
                -SUM(s.amount) as settlement_paid,
                0 as settlement_received
            FROM settlements s
            WHERE s.group_id = ${groupId}
                ${tripId ? sql`AND s.trip_id = ${tripId}` : sql``}
            GROUP BY s.from_user
            
            UNION ALL
            
            -- Money received in settlements
            SELECT 
                s.to_user as user_id,
                0 as paid_amount,
                0 as owed_amount,
                0 as settlement_paid,
                SUM(s.amount) as settlement_received
            FROM settlements s
            WHERE s.group_id = ${groupId}
                ${tripId ? sql`AND s.trip_id = ${tripId}` : sql``}
            GROUP BY s.to_user
        ),
        net_balances AS (
            SELECT 
                user_id,
                SUM(paid_amount) as total_paid,
                SUM(owed_amount) as total_owed,
                SUM(settlement_paid) as total_settlement_paid,
                SUM(settlement_received) as total_settlement_received
            FROM (
                SELECT * FROM expense_balances
                UNION ALL
                SELECT * FROM settlement_balances
            )
            GROUP BY user_id
        )
        SELECT 
            nb.user_id,
            u.username,
            u.first_name,
            -- Net balance: (paid + settlement_paid) - (owed + settlement_received)
            (COALESCE(nb.total_paid, 0) + COALESCE(nb.total_settlement_paid, 0)) - 
            (COALESCE(nb.total_owed, 0) + COALESCE(nb.total_settlement_received, 0)) as net_balance
        FROM net_balances nb
        JOIN users u ON nb.user_id = u.telegram_id
        WHERE ABS((COALESCE(nb.total_paid, 0) + COALESCE(nb.total_settlement_paid, 0)) - 
                  (COALESCE(nb.total_owed, 0) + COALESCE(nb.total_settlement_received, 0))) > 0.01
        ORDER BY net_balance DESC
    `);
    
    
    return toResultArray<any>(result).map((row: any) => ({
        userId: row.user_id,
        amount: row.net_balance,
        userName: row.username || row.first_name || 'Unknown'
    }));
}

/**
 * Get simplified settlement plan as a formatted message
 */
export async function getSimplifiedSettlementPlan(
    db: Database,
    groupId: string,
    tripId?: string
): Promise<{ transactions: Transaction[], message: string }> {
    const transactions = await simplifyDebts(db, groupId, tripId);
    
    if (transactions.length === 0) {
        return {
            transactions: [],
            message: '✅ All settled up! No payments needed.'
        };
    }
    
    let message = '💡 <b>Simplified Settlement Plan</b>\n\n';
    message += 'Instead of multiple transactions, just:\n\n';
    
    let totalAmount = 0;
    for (const txn of transactions) {
        message += `• <b>${txn.fromName}</b> pays <b>${txn.toName}</b>: $${txn.amount}\n`;
        totalAmount += txn.amount;
    }
    
    message += `\n<i>Total: $${totalAmount.toFixed(2)} across ${transactions.length} payment${transactions.length > 1 ? 's' : ''}</i>`;
    
    return { transactions, message };
}