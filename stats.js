const { connectDB, getCollection } = require('./db');

function normalizeDuration(sessionLength) {
    const duration = Number(sessionLength);
    return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

async function getUsersCollection() {
    await connectDB();
    return getCollection('users');
}

function isYesterday(dateValue) {
    if (!dateValue) return false;
    const lastSession = new Date(dateValue);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return lastSession.toDateString() === yesterday.toDateString();
}

async function updateUserStats(discordId, sessionLength) {
    if (!discordId) {
        throw new Error('discordId is required to update user stats.');
    }

    const duration = normalizeDuration(sessionLength);
    const users = await getUsersCollection();
    const now = new Date();
    const user = await users.findOne({ discordId });

    const daily = getCollection('daily_stats');

    const today = new Date().toISOString().split('T')[0];

    await daily.updateOne(
        { discordId, date: today },
        {
            $inc: {
                sessions: 1,
                hours: sessionLength
            }
        },
        { upsert: true }
    );

    if (!user) {
        const newUser = {
            discordId,
            total_sessions: 1,
            total_hours: duration,
            streak: 1,
            longest_streak: 1,
            last_session: now,
            created_at: now,
            updated_at: now
        };
        await users.insertOne(newUser);
        return newUser;
    }

    const previousStreak = Number(user.streak) || 0;
    const streak = isYesterday(user.last_session) ? previousStreak + 1 : 1;

    await users.updateOne(
        { discordId },
        {
            $inc: { total_sessions: 1, total_hours: duration },
            $set: { streak, last_session: now, updated_at: now },
            $max: { longest_streak: streak }
        }
    );

    return getUserStats(discordId);
}

async function getUserStats(discordId) {
    if (!discordId) {
        throw new Error('discordId is required to get user stats.');
    }

    const users = await getUsersCollection();
    return users.findOne({ discordId });
}

module.exports = { updateUserStats, getUserStats }; 