const storage = require('../utils/storage');

const deleteTimeouts = new Map();

module.exports = (client) => {
    client.on('voiceStateUpdate', async (oldState, newState) => {
        if (oldState.channelId && oldState.channel && oldState.channel.members.size === 0) {
            const entry = Object.entries(storage.data).find(([, userData]) => userData.privateVcId === oldState.channelId);
            if (!entry) return;

            const [ownerId, userData] = entry;
            if (deleteTimeouts.has(oldState.channelId)) return;

            const timeout = setTimeout(async () => {
                const channel = await client.channels.fetch(oldState.channelId).catch(() => null);
                if (!channel || channel.members.size !== 0) {
                    deleteTimeouts.delete(oldState.channelId);
                    return;
                }

                await channel.delete().catch(() => null);
                userData.privateVcId = null;
                await storage.saveData();
                deleteTimeouts.delete(oldState.channelId);
            }, 2 * 60 * 1000);

            deleteTimeouts.set(oldState.channelId, timeout);
        }

        if (newState.channelId && deleteTimeouts.has(newState.channelId)) {
            clearTimeout(deleteTimeouts.get(newState.channelId));
            deleteTimeouts.delete(newState.channelId);
        }
    });
};
