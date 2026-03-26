const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Bot is alive!'));

app.listen(3000, () => console.log('Server running on port 3000'));
const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const fs = require('fs');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const TOKEN = process.env.TOKEN; // 🔴 PUT YOUR TOKEN HERE
const PREMIUM_ROLE = "Premium"; // Role name

// Load data
let data = {};
if (fs.existsSync('data.json')) {
    data = JSON.parse(fs.readFileSync('data.json'));
}

// Bot ready
client.once('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// Commands
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // 🔹 Give Premium role (TEST)
    if (message.content === "!premium") {
        const role = message.guild.roles.cache.find(r => r.name === PREMIUM_ROLE);
        if (!role) return message.reply("❌ Premium role not found!");

        await message.member.roles.add(role);
        message.reply("✅ You are now Premium!");
    }

    // 🔹 Check-in system
    if (message.content.startsWith("!checkin")) {
        const userId = message.author.id;

        data[userId] = (data[userId] || 0) + 1;
        fs.writeFileSync('data.json', JSON.stringify(data, null, 2));

        message.reply(`📈 Check-in recorded! Total: ${data[userId]}`);
    }
});

// 🔔 Daily reminder (9 AM)
cron.schedule('0 9 * * *', () => {
    const channel = client.channels.cache.get('1486797459605815437'); // 🔴 PUT CHANNEL ID

    if (channel) {
        channel.send("📚 Daily check-in: What are you studying today?");
    }
});

client.login(TOKEN);