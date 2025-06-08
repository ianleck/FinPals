import { Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { handleAddEnhanced } from '../commands/add-enhanced';

interface ReceiptData {
    totalAmount?: number;
    items?: string[];
    date?: Date;
    vendor?: string;
    currency?: string;
}

export async function processReceiptImage(
    imageUrl: string,
    env: any
): Promise<ReceiptData> {
    try {
        // Fetch image and convert to Uint8Array
        const imageArray = await fetchImageAsUint8Array(imageUrl);
        
        // Use Cloudflare AI Workers for OCR
        const response = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
            image: [...imageArray], // Convert Uint8Array to regular array
            prompt: 'This is a receipt image. Please extract and list: 1) The total amount paid (look for TOTAL, AMOUNT DUE, or the largest price), 2) The vendor/store name, 3) The date if visible. Start your response with "TOTAL: $XX.XX" if you can find the total amount.',
            max_tokens: 512,
        });

        console.log('LLaVA response:', response);

        // Parse the AI response to extract receipt data
        const responseText = response.response || response.text || '';
        console.log('Response text to parse:', responseText);
        
        return parseReceiptText(responseText);
    } catch (error) {
        console.error('Error processing receipt:', error);
        throw new Error('Failed to process receipt image');
    }
}

async function fetchImageAsUint8Array(url: string): Promise<Uint8Array> {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return new Uint8Array(arrayBuffer);
}

function parseReceiptText(text: string): ReceiptData {
    const data: ReceiptData = {};
    
    console.log('Parsing receipt text:', text);
    
    // Extract total amount - look for various patterns
    const totalPatterns = [
        /(?:total|amount|sum|due|grand\s*total)[\s:]*\$?([\d,]+\.?\d*)/i,
        /\$?([\d,]+\.?\d*)[\s]*(?:total|amount|sum|due)/i,
        /(?:pay|charge|charged)[\s:]*\$?([\d,]+\.?\d*)/i,
        /\b\$?([\d,]+\.\d{2})\b.*(?:total|sum|due)/i,
        /(?:total|sum|due).*\$?([\d,]+\.\d{2})\b/i,
        // Look for standalone currency amounts that might be totals
        /\$?([\d,]+\.\d{2})(?:\s|$)/g
    ];
    
    for (const pattern of totalPatterns) {
        const matches = text.matchAll(pattern);
        const amounts = [];
        for (const match of matches) {
            const amount = parseFloat(match[1].replace(',', ''));
            if (amount > 0) {
                amounts.push(amount);
            }
        }
        
        // If we found amounts, use the largest one (likely the total)
        if (amounts.length > 0) {
            data.totalAmount = Math.max(...amounts);
            console.log('Found total amount:', data.totalAmount);
            break;
        }
    }
    
    // Extract vendor name - usually at the top of receipt
    const lines = text.split('\n').filter(line => line.trim());
    if (lines.length > 0) {
        // First non-empty line is often the vendor name
        data.vendor = lines[0].trim();
    }
    
    // Extract date - look for date patterns
    const dateMatch = text.match(/(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/);
    if (dateMatch) {
        data.date = new Date(dateMatch[1]);
    }
    
    // Extract items - lines that look like "Item name ... price"
    const itemPattern = /^(.+?)\s+\$?([\d,]+\.?\d*)$/gm;
    const items = [];
    let match;
    while ((match = itemPattern.exec(text)) !== null) {
        const itemName = match[1].trim();
        // Filter out likely totals, tax, etc.
        if (!itemName.match(/^(total|subtotal|tax|tip|discount)/i)) {
            items.push(itemName);
        }
    }
    if (items.length > 0) {
        data.items = items;
    }
    
    // Default currency
    data.currency = 'USD';
    
    return data;
}

export async function handleReceiptUpload(ctx: Context, db: D1Database, env: any) {
    const photo = ctx.message?.photo;
    if (!photo || photo.length === 0) {
        await ctx.reply('❌ No photo found. Please send a receipt image.');
        return;
    }
    
    // Get the largest photo size
    const largestPhoto = photo[photo.length - 1];
    
    try {
        // Get file info from Telegram
        const file = await ctx.api.getFile(largestPhoto.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
        
        // Send processing message
        const processingMsg = await ctx.reply('🔍 Processing receipt...');
        
        // Process the receipt
        const receiptData = await processReceiptImage(fileUrl, env);
        
        // Delete processing message
        await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
        
        if (!receiptData.totalAmount) {
            await ctx.reply(
                '❌ Could not extract amount from receipt.\n\n' +
                'Please add the expense manually:\n' +
                '`/add [amount] [description]`\n\n' +
                'Example: `/add 20 lunch`',
                { parse_mode: 'Markdown' }
            );
            return;
        }
        
        // Build description from receipt data
        const description = receiptData.vendor || 
                          (receiptData.items && receiptData.items[0]) || 
                          'Receipt expense';
        
        // Create a simulated message for the add command
        const simulatedMessage = {
            ...ctx.message,
            text: `/add ${receiptData.totalAmount} ${description}`
        };
        
        // Update context with simulated message
        const newCtx = {
            ...ctx,
            message: simulatedMessage
        };
        
        // Show receipt details
        let receiptInfo = `📄 <b>Receipt Detected</b>\n\n`;
        receiptInfo += `💵 Amount: <b>$${receiptData.totalAmount.toFixed(2)}</b>\n`;
        if (receiptData.vendor) receiptInfo += `🏪 Vendor: ${receiptData.vendor}\n`;
        if (receiptData.date) receiptInfo += `📅 Date: ${receiptData.date.toLocaleDateString()}\n`;
        if (receiptData.items && receiptData.items.length > 0) {
            receiptInfo += `\n📝 Items detected:\n`;
            receiptInfo += receiptData.items.slice(0, 5).map(item => `• ${item}`).join('\n');
            if (receiptData.items.length > 5) {
                receiptInfo += `\n... and ${receiptData.items.length - 5} more items`;
            }
        }
        
        await ctx.reply(receiptInfo, { parse_mode: 'HTML' });
        
        // Process as expense using enhanced add
        await handleAddEnhanced(newCtx as Context, db);
        
    } catch (error) {
        console.error('Error handling receipt:', error);
        await ctx.reply('❌ Failed to process receipt. Please try again or add the expense manually.');
    }
}