const cron = require('node-cron');
const storage = require('../utils/storage');
const embeds = require('../utils/embeds');
const session = require('../utils/session');

const HELP_CHANNEL = 'study-help';
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

        await user.send(`⏰ Reminder: keep working on your goal: ${goalEntry.goal}`).catch(() => null);
        goalEntry.lastReminder = now;
    }
    await storage.saveGoals();
}

async function sendReminderAlerts(client) {
    for (const [userId, userData] of Object.entries(storage.data)) {
        const reminders = [...(userData.reminders || [])];
        for (const reminder of reminders) {
            if (reminder.delivered) continue;
            if (Date.now() >= reminder.dueAt) {
                const user = await client.users.fetch(userId).catch(() => null);
                if (user) {
                    await user.send(`⏰ Reminder: ${reminder.text}`).catch(() => null);
                }
                storage.removeReminder(userId, reminder.id);
            }
        }
    }
}

async function cleanupPrivateRooms(client) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;

    for (const [userId, userData] of Object.entries(storage.data)) {
        if (!userData.privateCategoryId || !userData.privateCategoryCreatedAt) continue;
        if (userData.privateCategoryLastActive && userData.privateCategoryLastActive > cutoff) continue;

        const category = await client.channels.fetch(userData.privateCategoryId).catch(() => null);
        if (!category || !category.isTextBased && !category.children) {
            userData.privateCategoryId = null;
            userData.privateVcId = null;
            userData.privateTextId = null;
            userData.privateCategoryCreatedAt = 0;
            userData.privateCategoryLastActive = 0;
            continue;
        }

        const hasVoiceMembers = category.children.some(child => child.type === 2 && child.members.size > 0);
        if (!hasVoiceMembers) {
            await category.delete().catch(() => null);
            userData.privateCategoryId = null;
            userData.privateVcId = null;
            userData.privateTextId = null;
            userData.privateCategoryCreatedAt = 0;
            userData.privateCategoryLastActive = 0;
        }
    }
    await storage.saveData();
}

function registerCronJobs(client) {
    cron.schedule('0 9 * * *', async () => {
        const channel = client.channels.cache.find(c => c.isTextBased() && c.name === REMINDER_CHANNEL);
        if (channel) {
            channel.send('📚 Daily reminder: log in with `!checkin`, join a session, or set a goal.').catch(() => null);
        }
    });

    cron.schedule('0 */8 * * *', async () => {
        await sendGoalReminders(client);
    });

    cron.schedule('*/5 * * * *', async () => {
        const sessions = session.getAllSessions();
        await Promise.all(sessions.map(active => session.refreshStatusMessage(client, active.id)));
    });

    cron.schedule('*/1 * * * *', async () => {
        await sendReminderAlerts(client);
    });

    cron.schedule('0 * * * *', async () => {
        await cleanupPrivateRooms(client);
    });
}

module.exports = (client) => {
    client.once('ready', async () => {
        console.log(`✅ Logged in as ${client.user.tag}`);

        const helpChannel = client.channels.cache.find(c => c.isTextBased() && c.name === HELP_CHANNEL);
        if (helpChannel) {
            helpChannel.send({
                embeds: [embeds.buildInfoEmbed('StudyBot Ready', 'Use `!help` for commands. All features are available for everyone right now.')]
            }).catch(() => null);
        }

        registerCronJobs(client);

        const primaryGuild = getPrimaryGuild(client);
        if (!primaryGuild) {
            console.warn('No guild available when starting the bot.');
            return;
        }

        await primaryGuild.members.fetch();
    });
};
