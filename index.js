const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- CONFIGURATION SETTINGS ---
const BOT_TOKEN = process.env.BOT_TOKEN;       
const CHANNEL_ID = process.env.CHANNEL_ID;     
const TARGET_URL = 'http://100.117.181.94:8887'; // Your PC's Tailscale IP

// --- TIMER MODIFIERS (DYNAMICS) ---
const ACTIVE_INTERVAL = 30000;    // Check every 30 seconds when active
const BACKOFF_INTERVAL = 300000;  // Drop to 5 minutes when confirmed dead
const REQUEST_TIMEOUT = 25000;    // 25-second wait buffer for active image renders

let lastStatus = null; 
let offlineCounter = 0;
let currentLoopTimeout = null;

client.once('ready', () => {
    console.log(`🤖 Status Bot logged in as: ${client.user.tag}`);
    // Start the dynamic scheduling system loop
    scheduleNextCheck(ACTIVE_INTERVAL);
});

async function checkServerStatus() {
    let checkFinished = false;

    const req = http.get(TARGET_URL, { timeout: REQUEST_TIMEOUT }, async (res) => {
        if (checkFinished) return;
        checkFinished = true;
        
        // PC responded! Reset counter and update channel state
        offlineCounter = 0;
        await updateDiscordChannel(true);
        scheduleNextCheck(ACTIVE_INTERVAL);
    });

    req.on('error', async (err) => {
        if (checkFinished) return;
        checkFinished = true;
        await handleOfflineFailure();
    });

    req.on('timeout', async () => {
        if (checkFinished) return;
        checkFinished = true;
        req.destroy();
        await handleOfflineFailure();
    });
}

async function handleOfflineFailure() {
    offlineCounter++;
    console.log(`⚠️ Server check failed. Consecutive failure count: ${offlineCounter}/10`);
    
    // Process the offline channel update state cleanly
    await updateDiscordChannel(false);

    // Apply back-off cooling rules if 10 check failures are met back-to-back
    if (offlineCounter >= 10) {
        console.log(`💤 10 consecutive drops logged. Slowing checks down to 5-minute loops...`);
        scheduleNextCheck(BACKOFF_INTERVAL);
    } else {
        scheduleNextCheck(ACTIVE_INTERVAL);
    }
}

function scheduleNextCheck(msDelay) {
    // Clear out previous queues to prevent stack overflows or duplicate parallel requests
    if (currentLoopTimeout) clearTimeout(currentLoopTimeout);
    currentLoopTimeout = setTimeout(checkServerStatus, msDelay);
}

async function updateDiscordChannel(isOnline) {
    // Guard Clause: Stops useless Discord structural calls if status hasn't physically transitioned
    if (lastStatus === isOnline) return; 

    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        if (channel) {
            const targetName = isOnline ? '🟢│Server Online' : '🔴│Server Offline';
            await channel.setName(targetName);
            console.log(`📡 Status shifted to: ${targetName}`);
            lastStatus = isOnline;
        }
    } catch (error) {
        console.error('❌ Discord API rate limit or structure error:', error);
    }
}

client.login(BOT_TOKEN);
