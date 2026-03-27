const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');
const express = require('express');
const app = express();

// Constants
const TOKEN = process.env.TOKEN;
const PREMIUM_ROLE = "Premium";
const ALLOWED_CHANNEL = "premium-commands";
const DATA_FILE = 'data.json';
const GOALS_FILE = 'goals.json';


app.use(express.json());

app.post('/api/assign-premium', async (req, res) => {
    const { userId } = req.body;
    const guild = client.guilds.cache.get('YOUR_GUILD_ID');
    const member = guild.members.cache.get(userId);
    if (!member) return res.status(404).send('User not found');

    const role = guild.roles.cache.find(r => r.name === 'Premium');
    if (!role) return res.status(404).send('Role not found');

    await member.roles.add(role);
    res.send('Premium role assigned');
});

app.listen(4000, () => console.log('Bot API listening on port 4000'));

// In bot code
app.get('/api/check-premium/:userId', async (req, res) => {
    const userId = req.params.userId;
    const guild = client.guilds.cache.get('YOUR_GUILD_ID');
    const member = guild.members.cache.get(userId);
    if (!member) return res.status(404).send({ premium: false });
    const hasRole = member.roles.cache.some(r => r.name === 'Premium');
    res.send({ premium: hasRole });
});

// Global variables
let sessionActive = false;
let participants = new Set();
let userVCs = new Map();

// Data structures
let data = {};
let goals = {};

// Load data from files
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading data.json:', error);
        data = {};
    }

    try {
        if (fs.existsSync(GOALS_FILE)) {
            goals = JSON.parse(fs.readFileSync(GOALS_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading goals.json:', error);
        goals = {};
    }
}

// Save data to files
function saveData() {
    fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
        .catch(error => console.error('Error saving data.json:', error));
}

function saveGoals() {
    fs.promises.writeFile(GOALS_FILE, JSON.stringify(goals, null, 2))
        .catch(error => console.error('Error saving goals.json:', error));
}

// Helper functions
function isPremium(member) {
    return member && member.roles.cache.some(role => role.name === PREMIUM_ROLE);
}

function getUserData(userId) {
    if (!data[userId]) {
        data[userId] = {
            checkins: 0,
            sessions: 0,
            streak: 0,
            lastCheckin: 0
        };
    }
    return data[userId];
}

function sendSessionDashboard(channel) {
    if (!sessionActive || !channel) return;

    const embed = new EmbedBuilder()
        .setTitle("📊 Focus Session Dashboard")
        .setDescription(`Participants: ${participants.size}`)
        .setColor(0x00FF00)
        .addFields({
            name: "Participants",
            value: Array.from(participants).map(id => `<@${id}>`).join('\n') || "None"
        })
        .setTimestamp();

    channel.send({ embeds: [embed] }).catch(console.error);
}

function sendSessionButtons(channel) {
    if (!sessionActive || !channel) return;

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('join_session')
                .setLabel('Join Session')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('leave_session')
                .setLabel('Leave Session')
                .setStyle(ButtonStyle.Secondary)
        );

    channel.send({
        content: "🎯 Session in progress! Click a button to join/leave:",
        components: [row]
    }).catch(console.error);
}

// Initialize client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates // Added for VC management
    ]
});

// Load data on startup
loadData();

// Bot ready event
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    const channel = client.channels.cache.find(c => c.name === ALLOWED_CHANNEL && c.isTextBased());

    if (channel) {
        const commandsMessage =
            `📌 **Premium Commands**:
🎯 !goal <your goal> — Set a daily goal
🔥 !startsession — Start a focus session
✅ !join — Join the current session
🎧 !createvc — Create private VC
🗑️ !deletevc — Delete your private VC
✏️ !renamevc <name> — Rename your VC
📊 !stats — See your stats
🏆 !leaderboard — Top streaks
📈 !checkin — Daily check-in
✅ !done — Mark goal as done`;

        channel.send(commandsMessage).catch(console.error);
    }
});

// Handle button interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;

    if (interaction.customId === 'join_session') {
        if (!sessionActive) {
            return interaction.reply({ content: "❌ No active session.", ephemeral: true });
        }
        participants.add(userId);
        return interaction.reply({ content: "✅ You joined the session!", ephemeral: true });
    }

    if (interaction.customId === 'leave_session') {
        participants.delete(userId);
        return interaction.reply({ content: "⚠️ You left the session.", ephemeral: true });
    }
});

// Commands
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content.startsWith("!goal ")) {

        if (!isPremium(message.member)) {
            return message.reply("🔒 Premium only feature.").catch(console.error);
        }

        const userId = message.author.id;
        const goalText = message.content.slice(6).trim();

        if (!goalText) {
            return message.reply("❌ Please provide a goal.").catch(console.error);
        }

        goals[userId] = {
            goal: goalText,
            time: Date.now()
        };

        saveGoals();

        message.reply(`🎯 Goal set: ${goalText}`).catch(console.error);
    }
    if (message.content === "!done") {
        const userId = message.author.id;

        if (!goals[userId]) {
            return message.reply("❌ You have no active goal.").catch(console.error);
        }

        delete goals[userId];
        saveGoals();

        message.reply("🔥 Goal completed! Good job.").catch(console.error);
    }

    if (
        message.content.startsWith("!") &&
        message.channel.name !== ALLOWED_CHANNEL
    ) {
        return message.reply("❌ Use bot commands in #premium-commands").catch(console.error);
    }

    if (message.content === "!deletevc") {
        const vcId = userVCs.get(message.author.id);
        if (!vcId) return message.reply("❌ You don't have a VC.").catch(console.error);

        const channel = message.guild.channels.cache.get(vcId);
        if (channel) {
            channel.delete().catch(console.error);
            userVCs.delete(message.author.id);
            message.reply("🗑️ VC deleted.").catch(console.error);
        }
    }

    if (message.content.startsWith("!renamevc ")) {
        const newName = message.content.slice(10).trim();

        if (!newName) {
            return message.reply("❌ Please provide a new name.").catch(console.error);
        }

        const vcId = userVCs.get(message.author.id);
        if (!vcId) return message.reply("❌ You don't have a VC.").catch(console.error);

        const channel = message.guild.channels.cache.get(vcId);
        if (channel) {
            channel.setName(newName).catch(console.error);
            message.reply("✏️ VC renamed!").catch(console.error);
        }
    }

    // 🎧 Create Private VC (Premium)
    if (message.content === "!createvc") {

        if (!isPremium(message.member)) {
            return message.reply("🔒 Premium only feature.").catch(console.error);
        }

        if (userVCs.has(message.author.id)) {
            return message.reply("⚠️ You already have a private VC.").catch(console.error);
        }

        try {
            const channel = await message.guild.channels.create({
                name: `${message.author.username}'s Room`,
                type: 2, // Voice channel
                parent: message.channel.parentId || null, // same category
                permissionOverwrites: [
                    {
                        id: message.guild.id,
                        deny: ['Connect']
                    },
                    {
                        id: message.author.id,
                        allow: ['Connect', 'ManageChannels']
                    }
                ]
            });

            userVCs.set(message.author.id, channel.id);

            message.reply(`🎧 Your private VC is ready: ${channel.name}`).catch(console.error);
        } catch (error) {
            console.error('Error creating VC:', error);
            message.reply("❌ Failed to create VC.").catch(console.error);
        }
    }
    // 🔹 Give Premium role (TEST)
    if (message.content === "!premium") {
        const role = message.guild.roles.cache.find(r => r.name === PREMIUM_ROLE);
        if (!role) return message.reply("❌ Premium role not found!").catch(console.error);

        try {
            await message.member.roles.add(role);
            message.reply("✅ You are now Premium!").catch(console.error);
        } catch (error) {
            console.error('Error adding role:', error);
            message.reply("❌ Failed to add role.").catch(console.error);
        }
    }

    if (message.content === "!checkin") {

        const userId = message.author.id;
        const now = Date.now();

        const userData = getUserData(userId);

        const last = userData.lastCheckin;

        // 24h in ms
        const ONE_DAY = 24 * 60 * 60 * 1000;

        if (last && now - last < ONE_DAY) {
            return message.reply("⚠️ You already checked in today!").catch(console.error);
        }

        // Check if streak continues (within 48h window)
        if (last && now - last < ONE_DAY * 2) {
            userData.streak += 1;
        } else {
            userData.streak = 1;
        }

        userData.checkins += 1;
        userData.lastCheckin = now;

        saveData();

        message.reply(
            `🔥 Check-in done!\n` +
            `📈 Total: ${userData.checkins}\n` +
            `🔥 Streak: ${userData.streak} days`
        ).catch(console.error);
    }

    // 🔥 Focus Session System
    if (message.content === "!startsession") {

        if (!isPremium(message.member)) {
            return message.reply("🔒 This feature is for Premium members only.").catch(console.error);
        }

        if (sessionActive) {
            return message.reply("⚠️ A session is already running!").catch(console.error);
        }

        sessionActive = true;

        const channel = message.channel;

        channel.send("📢 Focus session starting in 5 minutes. Get ready!").catch(console.error);


        setTimeout(() => {
            channel.send("⏱️ Focus session STARTED! Stay focused for 50 minutes.\nType !join to participate.").catch(console.error);
            sendSessionButtons(channel);

            setTimeout(() => {
                channel.send(`✅ Session COMPLETE! ${participants.size} participants joined.`).catch(console.error);
                sessionActive = false;
                participants.clear();
            }, 50 * 60 * 1000);

        }, 5 * 60 * 1000);
    }

    if (message.content === "!stats") {
        const userId = message.author.id;

        const userData = getUserData(userId);

        message.reply(
            `📊 Your Stats:\n` +
            `📈 Check-ins: ${userData.checkins}\n` +
            `⏱️ Sessions: ${userData.sessions}\n` +
            `🔥 Streak: ${userData.streak} days`
        ).catch(console.error);
    }
    if (message.content === "!leaderboard") {

        const sorted = Object.entries(data)
            .sort((a, b) => (b[1].streak || 0) - (a[1].streak || 0))
            .slice(0, 5);

        let text = "🏆 Top Streaks:\n";

        sorted.forEach((entry, index) => {
            const [userId, userData] = entry;
            text += `${index + 1}. <@${userId}> — ${userData.streak || 0} 🔥\n`;
        });

        message.channel.send(text).catch(console.error);
    }

    if (message.content === "!join") {

        if (!sessionActive) {
            return message.reply("❌ No active session right now.").catch(console.error);
        }

        if (!isPremium(message.member)) {
            return message.reply("🔒 Only Premium members can join sessions.").catch(console.error);
        }

        const userId = message.author.id;

        if (participants.has(userId)) {
            return message.reply("⚠️ You are already in the session.").catch(console.error);
        }

        // Add to participants
        participants.add(userId);

        // Track sessions
        const userData = getUserData(userId);

        userData.sessions += 1;

        saveData();

        message.reply(`✅ Joined session! Total sessions: ${userData.sessions}`).catch(console.error);
    }
    });


// 🔔 Daily reminder (9 AM)
cron.schedule('0 9 * * *', () => {
    const channel = client.channels.cache.get('1486797459605815437'); // 🔴 PUT CHANNEL ID

    if (channel) {
        channel.send("📚 Daily check-in: What are you studying today?");
    }
});

// Update dashboard every 5 minutes during session
cron.schedule('*/5 * * * *', () => {
    const channel = client.channels.cache.find(c => c.name === ALLOWED_CHANNEL && c.isTextBased());
    if (sessionActive && channel) sendSessionDashboard(channel);
});

cron.schedule('*/30 * * * *', () => {
    for (let userId in goals) {
        const goal = goals[userId];

        client.users.fetch(userId)
            .then(user => user.send(`⏰ Reminder: Are you working on your goal?\n🎯 ${goal.goal}`))
            .catch(console.error);
    }
});

client.login(TOKEN);

app.get('/', (req, res) => res.send('Bot is alive!'));

app.listen(3000, () => console.log('Server running on port 3000'));