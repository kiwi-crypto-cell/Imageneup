const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// --- CONFIGURATION SETTINGS ---
const BOT_TOKEN = process.env.BOT_TOKEN;       
const CHANNEL_ID = process.env.CHANNEL_ID;     
const TARGET_URL = 'http://100.117.181.94:8887'; // Your PC's Tailscale IP

// --- TIMER MODIFIERS ---
const ACTIVE_INTERVAL = 30000;    // Check every 30 seconds when actively hunting status changes
const COOLDOWN_INTERVAL = 600000; // Check every 10 minutes when state is verified stable (10 in a row)
const REQUEST_TIMEOUT = 25000;    // 25-second wait buffer for active image renders

let lastStatus = null; 
let identicalCounter = 0;
let currentLoopTimeout = null;

client.once('ready', () => {
    console.log(`🤖 Status Bot logged in as: ${client.user.tag}`);
    // Boot the main checking scheduling loop
    runServerProbe();
});

function runServerProbe() {
    let checkFinished = false;

    // Fire network validation ping request
    const req = http.get(TARGET_URL, { timeout: REQUEST_TIMEOUT }, async (res) => {
        if (checkFinished) return;
        checkFinished = true;
        await processStatusResult(true);
    });

    req.on('error', async (err) => {
        if (checkFinished) return;
        checkFinished = true;
        await processStatusResult(false);
    });

    req.on('timeout', async () => {
        if (checkFinished) return;
        checkFinished = true;
        req.destroy();
        await processStatusResult(false);
    });
}

async function processStatusResult(isOnline) {
    const statusLabel = isOnline ? 'ONLINE' : 'OFFLINE';
    
    // 1. Constantly log every 30 seconds exactly what the probe found
    console.log(`[${new Date().toLocaleTimeString()}] 🔍 Probe test result: Server is ${statusLabel}`);

    // 2. Track stability streaks
    if (lastStatus === isOnline) {
        identicalCounter++;
        console.log(`⚙️ Streak stability count: ${identicalCounter}/10 consecutive ${statusLabel} states`);
    } else {
        // State shifted! Reset stability trackers instantly to hunt the new state speed
        identicalCounter = 1; 
        console.log(`📡 State shift detected! New baseline: ${statusLabel}`);
        await updateDiscordChannel(isOnline);
    }

    // Cache the verified status
    lastStatus = isOnline;

    // 3. Evaluate back-off scheduling based on streak limits
    if (identicalCounter >= 10) {
        console.log(`💤 Server state has been stable for 10 cycles. Backing off to 10-minute check intervals...`);
        scheduleNextCheck(COOLDOWN_INTERVAL);
    } else {
        scheduleNextCheck(ACTIVE_INTERVAL);
    }
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
    } catch (error) {
        console.error('❌ Discord API rate limit or permission error:', error);
    }
}

client.login(BOT_TOKEN);
