require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const Groq = require('groq-sdk');

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// Memory object to store recent conversation history for each user
// Structure: { "user_phone_id": [ {role: "user", content: "..."}, {role: "assistant", content: "..."} ] }
const chatMemory = {};
const MAX_MEMORY_LENGTH = 15; // Keep the last 15 messages for context

const SYSTEM_PROMPT = `INSERT YOURE SYSTEM PROMPT HERE. This is the "personality" and instructions for your assistant. You can be as creative as you want!`;

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
            // BULLETPROOF REGEX: Handles missing closing tags
            let cleanReply = replyContent.replace(/<think>[\s\S]*?(<\/think>|$)\n*/g, '').trim();

            if (!cleanReply) {
                cleanReply = "sigh... idk.";
            }

            // --- REALISM DELAY & TYPING SIMULATION ---
            
            // 1. Get the chat object
            const chat = await msg.getChat();

            // 2. Initial "Read" delay: Iroha is lazy, she takes 3 to 6 seconds just to pick up her phone
            const readDelay = Math.floor(Math.random() * 3000) + 3000; 
            await new Promise(resolve => setTimeout(resolve, readDelay));

            // 3. Show the "typing..." indicator at the top of WhatsApp
            await chat.sendStateTyping();

            // 4. "Typing" delay: Simulate the time it takes her to actually type the text (2 to 5 seconds)
            // You could make this math based on cleanReply.length, but random is fine for short messages!
            const typingDelay = Math.floor(Math.random() * 3000) + 2000;
            await new Promise(resolve => setTimeout(resolve, typingDelay));

            // -----------------------------------------

            // Reply to the user on WhatsApp with the cleaned text
            await msg.reply(cleanReply);

            // Add the CLEANED assistant's reply to memory
            chatMemory[userId].push({ role: 'assistant', content: cleanReply });

            // Truncate memory if it exceeds max length
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