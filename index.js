const { Client, GatewayIntentBits, REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const http = require('http');
const https = require('https'); // For web app API connection

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- CONFIGURATION SETTINGS ---
const BOT_TOKEN = process.env.BOT_TOKEN;       
const CHANNEL_ID = process.env.CHANNEL_ID;     
const TARGET_URL = 'http://100.117.181.94:8887'; // Your PC's Tailscale IP
const WEB_API_URL = 'https://web.app'; // Your online website backend

const ACTIVE_INTERVAL = 30000;    
const COOLDOWN_INTERVAL = 600000; 
const REQUEST_TIMEOUT = 25000;    

let lastStatus = null; 
let identicalCounter = 0;
let currentLoopTimeout = null;

// --- REGISTER SLASH COMMANDS ON STARTUP ---
client.once('ready', async () => {
    console.log(`🤖 Status & Generator Bot logged in as: ${client.user.tag}`);
    runServerProbe();

    // Register /prompt and /tags with Discord
    const commands = [
        {
            name: 'prompt',
            description: 'Detail a simple prompt idea or caption an attached image.',
            options: [
                {
                    name: 'text',
                    description: 'Your simple prompt idea (Leave blank if attaching an image)',
                    type: ApplicationCommandOptionType.String,
                    required: false
                },
                {
                    name: 'image',
                    description: 'Attach an image to generate a detailed caption prompt',
                    type: ApplicationCommandOptionType.Attachment,
                    required: false
                }
            ]
        },
        {
            name: 'tags',
            description: 'Generate structural style tag profiles from an image asset.',
            options: [
                {
                    name: 'image',
                    description: 'Attach the image asset to analyze',
                    type: ApplicationCommandOptionType.Attachment,
                    required: true // Enforces image requirement strictly
                }
            ]
        }
    ];

    try {
        const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('⚡ Successfully registered slash commands globally!');
    } catch (error) {
        console.error('❌ Failed to register slash commands:', error);
    }
});

// --- COMMAND EXECUTION HANDLER ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'prompt') {
        const textInput = options.getString('text');
        const imageInput = options.getAttachment('image');

        // 🛑 Error Check 1: User sent absolutely nothing
        if (!textInput && !imageInput) {
            return interaction.reply({ content: '❌ You must either provide a text prompt **OR** attach an image!', ephemeral: true });
        }

        // 🛑 Error Check 2: User tried to send text AND an image together
        if (textInput && imageInput) {
            return interaction.reply({ content: '❌ You cannot mix text and image inputs! Send text alone for expansion, or an image alone for a caption.', ephemeral: true });
        }

        await interaction.deferReply(); // Give your server up to 15 minutes to process the AI calculation

        if (textInput) {
            // Forward text to your website's prompt enhancer endpoint
            forwardTextToWebsite(textInput, interaction);
        } else if (imageInput) {
            // Forward image URL to your website's captioner endpoint
            forwardImageToWebsite(imageInput.url, 'prompt', interaction);
        }
    }

    if (commandName === 'tags') {
        const imageInput = options.getAttachment('image');
        await interaction.deferReply();
        // Forward image URL to your website's tagging endpoint
        forwardImageToWebsite(imageInput.url, 'tags', interaction);
    }
});

// --- WEBSITE API INTERACTION FORWARDERS ---
function forwardTextToWebsite(text, interaction) {
    // Modify this path string to match your exact website API endpoint route (e.g., /api/prompt)
    const apiEndpoint = `${WEB_API_URL}/api/prompt?q=${encodeURIComponent(text)}`;

    https.get(apiEndpoint, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const parsed = JSON.parse(data);
                // Adjust 'parsed.result' to match your exact website backend JSON return field
                interaction.editReply(`✍️ **Detailed Prompt:**\n\`\`\`\n${parsed.result || data}\n\`\`\``);
            } catch {
                interaction.editReply(`✍️ **Detailed Prompt:**\n\`\`\`\n${data}\n\`\`\``);
            }
        });
    }).on('error', () => interaction.editReply('❌ Failed to connect to the online website generator backend.'));
}

function forwardImageToWebsite(imageUrl, mode, interaction) {
    // Send the Discord CDN image URL directly to your website backend so your site can download and analyze it
    const apiEndpoint = `${WEB_API_URL}/api/${mode === 'tags' ? 'tags' : 'caption'}?url=${encodeURIComponent(imageUrl)}`;

    https.get(apiEndpoint, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            const prefix = mode === 'tags' ? '🏷️ **Generated Style Tags:**' : '🖼️ **Image Caption Prompt:**';
            try {
                const parsed = JSON.parse(data);
                interaction.editReply(`${prefix}\n\`\`\`\n${parsed.result || data}\n\`\`\``);
            } catch {
                interaction.editReply(`${prefix}\n\`\`\`\n${data}\n\`\`\``);
            }
        });
    }).on('error', () => interaction.editReply('❌ Failed to forward image asset to website backend.'));
}

// --- KEEP YOUR ORIGINAL MONITOR PROBE COMPLETELY UNTOUCHED BELOW ---
function runServerProbe() {
    let checkFinished = false;
    const req = http.get(TARGET_URL, { timeout: REQUEST_TIMEOUT }, async (res) => {
        if (checkFinished) return;
        checkFinished = true;
        await processStatusResult(true);
    });
    req.on('error', async () => { if (!checkFinished) { checkFinished = true; await processStatusResult(false); } });
    req.on('timeout', async () => { if (!checkFinished) { checkFinished = true; req.destroy(); await processStatusResult(false); } });
}

async function processStatusResult(isOnline) {
    const statusLabel = isOnline ? 'ONLINE' : 'OFFLINE';
    console.log(`[${new Date().toLocaleTimeString()}] 🔍 Probe test result: Server is ${statusLabel}`);
    if (lastStatus === isOnline) { identicalCounter++; } else { identicalCounter = 1; await updateDiscordChannel(isOnline); }
    lastStatus = isOnline;
    if (identicalCounter >= 10) { scheduleNextCheck(COOLDOWN_INTERVAL); } else { scheduleNextCheck(ACTIVE_INTERVAL); }
}

function scheduleNextCheck(msDelay) {
    if (currentLoopTimeout) clearTimeout(currentLoopTimeout);
    currentLoopTimeout = setTimeout(runServerProbe, msDelay);
}

async function updateDiscordChannel(isOnline) {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (channel) {
            const targetName = isOnline ? '🟢│Server Online' : '🔴│Server Offline';
            await channel.setName(targetName);
            console.log(`🟩 Successfully updated Discord channel name to: ${targetName}`);
        }
    } catch (error) { console.error('❌ Discord API Error:', error); }
}

client.login(BOT_TOKEN);
