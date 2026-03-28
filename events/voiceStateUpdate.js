const storage = require('../utils/storage');

const voiceTimers = new Map();

function formatDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

module.exports = (client) => {
    client.on('voiceStateUpdate', async (oldState, newState) => {
        const userId = newState.id;
        const leftChannelId = oldState.channelId;
        const joinedChannelId = newState.channelId;
        const now = Date.now();

        if (leftChannelId && leftChannelId !== joinedChannelId) {
            const entry = voiceTimers.get(userId);
            if (entry && entry.channelId === leftChannelId) {
                const durationMinutes = Math.max(1, Math.round((now - entry.joinedAt) / 60000));
                const userData = storage.getUserData(userId);
                userData.totalStudyMinutes += durationMinutes;
                userData.sessions += 1;
                userData.completedSessions += 1;
                userData.lastSessionAt = now;
                const dayKey = formatDayKey();
                userData.dailyStudy[dayKey] = (userData.dailyStudy[dayKey] || 0) + durationMinutes;
                await storage.saveData();
                voiceTimers.delete(userId);
            }
        }

        if (joinedChannelId && joinedChannelId !== leftChannelId) {
            voiceTimers.set(userId, { channelId: joinedChannelId, joinedAt: now });

            const ownerEntry = Object.entries(storage.data).find(([, userData]) => userData.privateVcId === joinedChannelId);
            if (ownerEntry) {
                ownerEntry[1].privateCategoryLastActive = now;
                await storage.saveData();
            }
        }
    });
};
