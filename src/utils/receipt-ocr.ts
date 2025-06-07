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
        // Use Cloudflare AI Workers for OCR
        const response = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
            image: [await fetchImageAsArrayBuffer(imageUrl)],
            prompt: 'Extract receipt information from this image. List the total amount, vendor name, date, and individual items with prices. Format the response as structured text.',
            max_tokens: 512,
        });

        // Parse the AI response to extract receipt data
        return parseReceiptText(response.text || '');
    } catch (error) {
        console.error('Error processing receipt:', error);
        throw new Error('Failed to process receipt image');
    }
}

async function fetchImageAsArrayBuffer(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    return await response.arrayBuffer();
}

function parseReceiptText(text: string): ReceiptData {
    const data: ReceiptData = {};
    
    // Extract total amount - look for patterns like "Total: $XX.XX" or "TOTAL XX.XX"
    const totalMatch = text.match(/(?:total|amount|sum)[\s:]*\$?([\d,]+\.?\d*)/i);
    if (totalMatch) {
        data.totalAmount = parseFloat(totalMatch[1].replace(',', ''));
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
            await ctx.reply('❌ Could not extract amount from receipt. Please add the expense manually.');
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