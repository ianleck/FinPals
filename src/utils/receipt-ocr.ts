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
            prompt: 'Analyze this receipt image and extract the total amount. Look for words like TOTAL, AMOUNT DUE, BALANCE, or the largest number on the receipt. Reply with the actual dollar amount found. For example, if the total is $45.67, write "TOTAL: $45.67". Also mention the vendor name if visible.',
            max_tokens: 512,
        });

        console.log('LLaVA response:', response);

        // Parse the AI response to extract receipt data
        // The response might be in different fields depending on the model
        const responseText = response.description || response.response || response.text || JSON.stringify(response);
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
        /(?:total|amount|sum|due|grand\s*total)[\s:]*\$?([\d,]+\.?\d*)/gi,
        /\$?([\d,]+\.?\d*)[\s]*(?:total|amount|sum|due)/gi,
        /(?:pay|charge|charged)[\s:]*\$?([\d,]+\.?\d*)/gi,
        /\b\$?([\d,]+\.\d{2})\b.*(?:total|sum|due)/gi,
        /(?:total|sum|due).*\$?([\d,]+\.\d{2})\b/gi,
        // Look for standalone currency amounts that might be totals
        /\$?([\d,]+\.\d{2})(?:\s|$)/g
    ];
    
    // First check for simple number patterns in text like "total of 78.87"
    const simpleNumberMatch = text.match(/(?:total|amount|sum)\s+(?:of|is|:)?\s*\$?([\d,]+\.?\d*)/i);
    if (simpleNumberMatch) {
        const amount = parseFloat(simpleNumberMatch[1].replace(',', ''));
        if (amount > 0) {
            data.totalAmount = amount;
            console.log('Found total amount from simple pattern:', data.totalAmount);
        }
    }
    
    // Also check if the AI literally returned "TOTAL: $XX.XX" as instructed
    if (!data.totalAmount) {
        const directTotalMatch = text.match(/TOTAL:\s*\$?([\d,]+\.?\d*)/i);
        if (directTotalMatch) {
            const amount = parseFloat(directTotalMatch[1].replace(',', ''));
            if (amount > 0) {
                data.totalAmount = amount;
                console.log('Found direct total amount:', data.totalAmount);
            }
        }
    }
    
    // Try other patterns only if we haven't found a total yet
    if (!data.totalAmount) {
        for (const pattern of totalPatterns) {
            const match = pattern.global ? [...text.matchAll(pattern)] : [text.match(pattern)].filter(Boolean);
            const amounts = [];
            for (const m of match) {
                if (m && m[1]) {
                    const amount = parseFloat(m[1].replace(',', ''));
                    if (amount > 0 && !isNaN(amount)) {
                        amounts.push(amount);
                    }
                }
            }
            
            // If we found amounts, use the largest one (likely the total)
            if (amounts.length > 0) {
                data.totalAmount = Math.max(...amounts);
                console.log('Found total amount from pattern:', data.totalAmount);
                break;
            }
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
        if (ctx.chat?.id && processingMsg?.message_id) {
            await ctx.api.deleteMessage(ctx.chat.id, processingMsg.message_id);
        }
        
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
        
        // Instead of modifying context, send a new message with the add command
        const addCommandText = `/add ${receiptData.totalAmount} ${description}`;
        await ctx.reply(
            `Adding expense: ${addCommandText}\n\n` +
            'Processing...',
            { parse_mode: 'HTML' }
        );
        
        // Create a new fake context with the add command
        if (!ctx.message) {
            console.error('No message in context');
            await ctx.reply('❌ Unable to process receipt - missing message context.');
            return;
        }
        
        const fakeMessage = {
            message_id: ctx.message.message_id + 1000000, // Fake message ID
            date: ctx.message.date,
            chat: ctx.message.chat,
            from: ctx.message.from,
            text: addCommandText,
            entities: [],
        };
        
        const fakeContext = Object.create(ctx);
        fakeContext.message = fakeMessage;
        fakeContext.msg = fakeMessage;
        fakeContext.update = {
            ...ctx.update,
            message: fakeMessage
        };
        
        // Process as expense using enhanced add
        await handleAddEnhanced(fakeContext, db);
        
    } catch (error) {
        console.error('Error handling receipt:', error);
        await ctx.reply('❌ Failed to process receipt. Please try again or add the expense manually.');
    }
}