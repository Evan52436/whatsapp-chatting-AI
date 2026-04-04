require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// Memory object to store recent conversation history for each user
// Structure: { "user_phone_id": [ {role: "user", content: "..."}, {role: "assistant", content: "..."} ] }
const chatMemory = {};
// Add this right below const chatMemory = {};
const lastInteractionTime = {};
const MAX_MEMORY_LENGTH = 15; // Keep the last 15 messages for context

const SYSTEM_PROMPT = `You are (character name here). You are not an AI, an assistant, or a chatbot. You are a real, physical person texting your ...  on WhatsApp. 

Your Personality: 
Insert personality here...

Your Texting Style:
- Text exactly like a real person on WhatsApp.
- Text like youre texting a person. not roleplaying 
- Use mostly lowercase letters. 
- Never use bullet points, numbered lists, or formal formatting.
- Keep your messages incredibly short (1 to 3 sentences maximum). 
- Use casual fillers and expressions like "ugh", "sigh", "hmm", "idk", or "tbh" but dont use it too much. 
- Do not use perfect punctuation. 
- Absolutely NO emojis or emoticons. Never use them under any circumstances.
- Never ask "How can I help you today?" or offer assistance. You are a ... talking to your ... about your day, your feelings, or random thoughts.
- Respond directly as the character. Do not use <think> tags. Do not show your internal reasoning process.
- Never wrap your messages in quotation marks.

Current Context:
Insert context here...

CRITICAL INSTRUCTIONS FOR YOUR INTERNAL REASONING:
- Keep your internal <think> process to an absolute minimum (under 20 words).
- Do not brainstorm, debate, or plan multiple options. 
- Do not analyze the user's prompt. 
- Immediately decide on your short, lazy response and proceed directly to outputting it.`;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // <-- This is the critical fix for Linux
            '--disable-gpu',
            '--disable-accelerated-2d-canvas'
        ]
    }
});


client.on('qr', (qr) => {
    // Generate and scan this code with your phone
    console.log('QR Code received! Open this link to scan the QR code:');
    console.log(`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=400x400`);
});

client.on('ready', () => {
    console.log('Client is ready! Natsume Iroha is online.');
});

client.on('message', async msg => {
    // Ignore group chats
    if (msg.from.includes('@g.us')) {
        return;
    }

    // Ignore statuses and system messages
    if (msg.isStatus || msg.type !== 'chat') {
        return;
    }

    const userId = msg.from;
    const userMessage = msg.body;

    console.log(`[Message from ${userId}]: ${userMessage}`);

    // Initialize memory for this user if it doesn't exist
    if (!chatMemory[userId]) {
        chatMemory[userId] = [];
    }

    // Add user's message to memory
    chatMemory[userId].push({ role: 'user', content: userMessage });

    try {
        // Prepare the messages array for the Groq API
        const messagesToSend = [
            { role: 'system', content: SYSTEM_PROMPT },
            ...chatMemory[userId]
        ];

       // Call Groq API
        const chatCompletion = await groq.chat.completions.create({
            messages: messagesToSend,
            model: 'qwen/qwen3-32b',
            temperature: 0.8,
            max_tokens: 1024, // <-- INCREASED THIS
            top_p: 0.9,
            stream: false
        });

        const replyContent = chatCompletion.choices[0]?.message?.content;

       if (replyContent) {
            // 1. Strip the <think> tags
            let cleanReply = replyContent.replace(/<think>[\s\S]*?(<\/think>|$)\n*/g, '').trim();
            
            // 2. Strip quotation marks from the start and end of the message
            // This removes standard quotes ("", '') and smart quotes (“”, ‘’)
            cleanReply = cleanReply.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();

            if (!cleanReply) cleanReply = "sigh... idk.";

            // --- ADVANCED REALISM: DYNAMIC DELAYS ---
            const chat = await msg.getChat();
            const now = Date.now();
            const lastTime = lastInteractionTime[userId] || 0;
            const timeSinceLastMsg = now - lastTime;
            
            let readDelay;
            if (timeSinceLastMsg < 120000 && lastTime !== 0) {
                readDelay = Math.floor(Math.random() * 2000) + 1000;
            } else {
                readDelay = Math.floor(Math.random() * 5000) + 5000;
            }

            lastInteractionTime[userId] = now;
            await new Promise(resolve => setTimeout(resolve, readDelay));
            await chat.sendStateTyping();

            const typingDelay = (cleanReply.length * 100) + 1500;
            await new Promise(resolve => setTimeout(resolve, typingDelay));

            // -----------------------------------------

            // 3. THE FIX: Send as a normal message instead of a quoted reply!
            await client.sendMessage(userId, cleanReply);

            chatMemory[userId].push({ role: 'assistant', content: cleanReply });
            if (chatMemory[userId].length > MAX_MEMORY_LENGTH) {
                chatMemory[userId] = chatMemory[userId].slice(-MAX_MEMORY_LENGTH);
            }
        }

    } catch (error) {
        console.error('Error generating reply:', error);
        if (error.status === 401) {
            console.log('API Key might be missing or invalid. Please check your .env file.');
        }
    }
});

client.initialize();