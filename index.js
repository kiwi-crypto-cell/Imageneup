const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http'); // or 'https' if using ssl

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- CONFIGURATION SETTINGS ---
const BOT_TOKEN = process.env.BOT_TOKEN;       // Set this in your cloud settings
const CHANNEL_ID = process.env.CHANNEL_ID;     // Set this in your cloud settings
const TARGET_URL = 'http://100.117.181.94:8887'; // Your PC's Tailscale IP
const PING_INTERVAL = 360000; // 6 minutes (Safely respects Discord rate limits)

let lastStatus = null; 

client.once('ready', () => {
    console.log(`🤖 Cloud Status Bot is active: ${client.user.tag}`);
    checkServerStatus();
    setInterval(checkServerStatus, PING_INTERVAL);
});

function checkServerStatus() {
    // Attempt a quick HTTP request to your AI server's active interface port
    const req = http.get(TARGET_URL, { timeout: 5000 }, async (res) => {
        // If it responds with ANY status code (even 404/401), the machine is alive and running
        await updateDiscordChannel(true);
    });

    req.on('error', async (err) => {
        // Connection refused or timed out means your PC is off or port forwarding closed
        await updateDiscordChannel(false);
    });

    req.on('timeout', async () => {
        req.destroy();
        await updateDiscordChannel(false);
    });
}

async function updateDiscordChannel(isOnline) {
    if (lastStatus === isOnline) return; // Prevent spamming the Discord API if no change

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (channel) {
            const targetName = isOnline ? '🟢│Server Online' : '🔴│Server Offline';
            await channel.setName(targetName);
            console.log(`📡 Status shifted to: ${targetName}`);
            lastStatus = isOnline;
        }
    } catch (error) {
        console.error('❌ Discord API error:', error);
    }
}

client.login(BOT_TOKEN);
