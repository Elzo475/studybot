require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const storage = require('./utils/storage');
const messageCreate = require('./events/messageCreate');
const interactionCreate = require('./events/interactionCreate');
const voiceStateUpdate = require('./events/voiceStateUpdate');
const readyEvent = require('./events/ready');
const { connectDB } = require('./db');

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const GUILD_ID = process.env.GUILD_ID || null;


if (!TOKEN) {
    throw new Error('TOKEN must be defined in your .env file.');
}

const app = express();
app.use(express.json());

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

app.get('/', (req, res) => res.send('Bot is alive!'));
