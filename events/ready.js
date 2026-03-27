const cron = require('node-cron');
const storage = require('../utils/storage');
const embeds = require('../utils/embeds');
const session = require('../utils/session');

const HELP_CHANNEL = 'premium-commands';
const REMINDER_CHANNEL = 'study-reminders';

function getPrimaryGuild(client) {
    if (process.env.GUILD_ID) {
        return client.guilds.cache.get(process.env.GUILD_ID);
    }
    return client.guilds.cache.first();
}

async function sendGoalReminders(client) {
    const goals = storage.getAllGoals();

    for (const [userId, goalEntry] of Object.entries(goals)) {
        const user = await client.users.fetch(userId).catch(() => null);
        if (!user) continue;

        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        if (goalEntry.lastReminder && now - goalEntry.lastReminder < oneDay) continue;

        await user.send(`⏰ Reminder: keep working on your premium goal: ${goalEntry.goal}`).catch(() => null);
        goalEntry.lastReminder = now;
    }
    await storage.saveGoals();
}

function registerCronJobs(client) {
    cron.schedule('0 9 * * *', async () => {
        const channel = client.channels.cache.find(c => c.isTextBased() && c.name === REMINDER_CHANNEL);
        if (channel) {
            channel.send('📚 Daily reminder: log in with `!checkin`, join a session, or refresh your study goal.').catch(() => null);
        }
    });

    cron.schedule('0 */8 * * *', async () => {
        await sendGoalReminders(client);
    });

    cron.schedule('*/5 * * * *', async () => {
        if (!session.isSessionActive()) return;
        const active = session.getActiveSession();
        const channel = await client.channels.fetch(active.channelId).catch(() => null);
        if (channel) {
            await session.refreshStatusMessage(client);
        }
    });
}

module.exports = (client) => {
    client.once('ready', async () => {
        console.log(`✅ Logged in as ${client.user.tag}`);

        const helpChannel = client.channels.cache.find(c => c.isTextBased() && c.name === HELP_CHANNEL);
        if (helpChannel) {
            helpChannel.send({
                embeds: [embeds.buildInfoEmbed('StudyBot Ready', 'Use `!help` for commands. Premium commands include `!goal`, `!startsession`, and `!createvc`.')]
            }).catch(() => null);
        }

        registerCronJobs(client);

        const primaryGuild = getPrimaryGuild(client);
        if (!primaryGuild) {
            console.warn('No guild available for premium role checks.');
            return;
        }

        await primaryGuild.members.fetch();
    });
};
