import { Context } from 'grammy';
import type { D1Database } from '@cloudflare/workers-types';
import { handleAddEnhanced } from '../commands/add-enhanced';

interface TranscriptionResult {
    text: string;
    confidence?: number;
}

export async function transcribeVoiceMessage(
    voiceFileUrl: string,
    env: any
): Promise<TranscriptionResult> {
    try {
        // Download voice file
        const response = await fetch(voiceFileUrl);
        const audioBuffer = await response.arrayBuffer();
        
        // Use Cloudflare AI for speech-to-text
        const audioArray = new Uint8Array(audioBuffer);
        const result = await env.AI.run('@cf/openai/whisper', {
            audio: Array.from(audioArray),
        });
        
        return {
            text: result.text || '',
            confidence: result.confidence
        };
    } catch (error) {
        console.error('Error transcribing voice:', error);
        throw new Error('Failed to transcribe voice message');
    }
}

export async function handleVoiceMessage(ctx: Context, db: D1Database, env: any) {
    const voice = ctx.message?.voice;
    if (!voice) {
        await ctx.reply('❌ No voice message found.');
        return;
    }
    
    try {
        // Get file info from Telegram
        const file = await ctx.api.getFile(voice.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
        
        // Send processing message
        const processingMsg = await ctx.reply('🎤 Processing voice message...');
        
        // Transcribe the voice message
        const transcription = await transcribeVoiceMessage(fileUrl, env);
        
        // Delete processing message
        await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
        
        if (!transcription.text) {
            await ctx.reply('❌ Could not transcribe voice message. Please try typing the expense instead.');
            return;
        }
        
        // Parse the transcription for expense details
        const expenseData = parseExpenseFromText(transcription.text);
        
        if (!expenseData.amount) {
            await ctx.reply(
                `🎤 <b>Transcription:</b> "${transcription.text}"\n\n` +
                `❌ Could not extract expense amount. Please use format like:\n` +
                `"Add 50 dollars for lunch" or "Twenty dollars for coffee"`,
                { parse_mode: 'HTML' }
            );
            return;
        }
        
        // Show transcription result
        await ctx.reply(
            `🎤 <b>Voice Transcription:</b>\n"${transcription.text}"\n\n` +
            `💵 <b>Detected:</b> $${expenseData.amount.toFixed(2)} for ${expenseData.description}`,
            { 
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '✅ Confirm', callback_data: `voice_confirm:${expenseData.amount}:${expenseData.description}` },
                        { text: '❌ Cancel', callback_data: 'voice_cancel' }
                    ]]
                }
            }
        );
        
    } catch (error) {
        console.error('Error handling voice message:', error);
        await ctx.reply('❌ Failed to process voice message. Please try again or type the expense instead.');
    }
}

function parseExpenseFromText(text: string): { amount?: number; description?: string } {
    const normalizedText = text.toLowerCase();
    
    // Try to find amount patterns
    let amount: number | undefined;
    let description = 'Expense';
    
    // Pattern 1: "X dollars/bucks" or "$X"
    const dollarMatch = normalizedText.match(/(\d+(?:\.\d+)?)\s*(?:dollars?|bucks|\$)|(?:\$|dollar sign)\s*(\d+(?:\.\d+)?)/);
    if (dollarMatch) {
        amount = parseFloat(dollarMatch[1] || dollarMatch[2]);
    }
    
    // Pattern 2: Written numbers
    if (!amount) {
        const writtenNumbers: { [key: string]: number } = {
            'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
            'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
            'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
            'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
            'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
            'eighty': 80, 'ninety': 90, 'hundred': 100
        };
        
        for (const [word, value] of Object.entries(writtenNumbers)) {
            if (normalizedText.includes(word)) {
                amount = value;
                break;
            }
        }
    }
    
    // Try to extract description
    // Common patterns: "for [description]", "on [description]", "[description] expense"
    const descPatterns = [
        /(?:for|on)\s+(.+?)(?:\s+expense)?$/i,
        /add\s+\d+.*?(?:for|on)\s+(.+)/i,
        /(.+?)\s+expense/i,
        /spent.*?on\s+(.+)/i
    ];
    
    for (const pattern of descPatterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
            description = match[1].trim();
            break;
        }
    }
    
    // Clean up description
    description = description
        .replace(/\s+dollars?\s*$/i, '')
        .replace(/^\s*(?:a|an|the)\s+/i, '')
        .trim();
    
    return { amount, description: description || 'Expense' };
}