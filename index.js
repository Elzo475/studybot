require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const storage = require('./utils/storage');
const sessionManager = require('./utils/session');
const messageCreate = require('./events/messageCreate');
const interactionCreate = require('./events/interactionCreate');
const voiceStateUpdate = require('./events/voiceStateUpdate');
const readyEvent = require('./events/ready');
const { connectDB } = require('./db');

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const ROOM_INACTIVITY_MS = 10 * 60 * 60 * 1000;

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const GUILD_ID = process.env.GUILD_ID || null;


if (!TOKEN) {
    throw new Error('TOKEN must be defined in your .env file.');
}

const app = express();
app.use(express.json());

async function cleanupInactivePrivateRooms(client) {
    const now = Date.now();
    let dataChanged = false;

    for (const [userId, userData] of Object.entries(storage.data)) {
        if (!userData.privateCategoryId) continue;

        const lastActive = Math.max(userData.privateCategoryLastActive || 0, userData.privateCategoryCreatedAt || 0);
        if (!lastActive || now - lastActive < ROOM_INACTIVITY_MS) continue;

        const category = await client.channels.fetch(userData.privateCategoryId).catch(() => null);
        if (category && category.delete) {
            await category.delete().catch(() => null);
        }

        userData.privateCategoryId = null;
        userData.privateVcId = null;
        userData.privateTextId = null;
        userData.privateCategoryCreatedAt = 0;
        userData.privateCategoryLastActive = 0;
        dataChanged = true;
    }

    if (dataChanged) {
        await storage.saveData();
    }
}

function startCleanupLoops(client) {
    setInterval(() => {
        sessionManager.cleanupExpiredPausedSessions(client).catch(err => console.error('Session cleanup failed:', err));
        cleanupInactivePrivateRooms(client).catch(err => console.error('Private room cleanup failed:', err));
    }, CLEANUP_INTERVAL_MS);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

async function init() {
    await connectDB();
    storage.loadData();
    readyEvent(client);
    messageCreate(client);
    interactionCreate(client);
    voiceStateUpdate(client);
    await client.login(TOKEN);
    startCleanupLoops(client);
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

init().catch(err => {
    console.error('Initialization failed:', err);
    process.exit(1);
});

app.post('/api/assign-premium', async (req, res) => {
    const { userId } = req.body;
    const guild = GUILD_ID ? client.guilds.cache.get(GUILD_ID) : client.guilds.cache.first();
    if (!guild) return res.status(404).send('Guild not found');

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(404).send('User not found');

    const role = guild.roles.cache.find(r => r.name === 'Premium');
    if (!role) return res.status(404).send('Role not found');

    await member.roles.add(role).catch(() => null);
    res.send('Premium role assigned');
});

app.get('/api/check-premium/:userId', async (req, res) => {
    const userId = req.params.userId;
    const guild = GUILD_ID ? client.guilds.cache.get(GUILD_ID) : client.guilds.cache.first();
    if (!guild) return res.status(404).send({ premium: false });

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return res.status(404).send({ premium: false });

    const hasRole = member.roles.cache.some(role => role.name === 'Premium');
    res.send({ premium: hasRole });
});

app.get('/api/bot-status', (req, res) => {
    try {
        const guild = GUILD_ID ? client.guilds.cache.get(GUILD_ID) : client.guilds.cache.first();
        const premiumRole = guild ? guild.roles.cache.find(role => role.name === 'Premium') : null;
        const premiumUsers = premiumRole ? premiumRole.members.size : 0;
        const totalMembers = guild ? guild.memberCount || 0 : 0;
        const activeSessions = Array.isArray(sessionManager.getAllSessions()) ? sessionManager.getAllSessions().length : 0;

        res.json({
            botName: client.user?.username || 'StudyBot',
            uptimeSeconds: Math.floor(process.uptime()),
            guildCount: client.guilds.cache.size,
            totalMembers,
            premiumUsers,
            activeSessions
        });
    } catch (err) {
        console.error('Failed to fetch bot status:', err);
        res.status(500).json({ error: 'Unable to retrieve bot status' });
    }
});

app.get('/', (req, res) => res.send('Bot is alive!'));
