const { buildStatusEmbed, buildSessionActionRow, buildSessionSummaryEmbed, buildInfoEmbed, formatDayKey } = require('./embeds');
const storage = require('./storage');

let activeSession = null;

function getActiveSession() {
    return activeSession;
}

function isSessionActive() {
    return activeSession !== null;
}

function createUserSessionData(userData, minutes) {
    userData.sessions += 1;
    userData.totalStudyMinutes += minutes;
    userData.completedSessions += 1;
    userData.lastSessionAt = Date.now();
    const dayKey = formatDayKey();
    userData.dailyStudy[dayKey] = (userData.dailyStudy[dayKey] || 0) + minutes;
}

async function startSession({ client, channel, hostId, durationMinutes = 50, isPrivate = false }) {
    if (activeSession) {
        throw new Error('A session is already active.');
    }

    activeSession = {
        hostId,
        durationMinutes,
        isPrivate,
        participants: new Set([hostId]),
        confirmed: new Set(),
        createdAt: Date.now(),
        started: false,
        startTime: null,
        channelId: channel.id,
        statusMessageId: null,
        countdownTimer: null,
        updateTimer: null,
        endTimer: null
    };

    const startingEmbed = buildInfoEmbed(
        '⏳ Focus Session Incoming',
        `A ${durationMinutes}-minute focus session will begin in 1 minute. Use the buttons below to join, leave, or confirm completion.`
    );

    const statusMessage = await channel.send({
        embeds: [buildStatusEmbed(activeSession)],
        components: [buildSessionActionRow()]
    });

    activeSession.statusMessageId = statusMessage.id;

    activeSession.countdownTimer = setTimeout(async () => {
        activeSession.started = true;
        activeSession.startTime = Date.now();

        const liveEmbed = buildInfoEmbed('🚀 Session Started', `Your focus session is live for ${durationMinutes} minutes. Stay on task and check back here for progress updates.`);
        await channel.send({ embeds: [liveEmbed] }).catch(() => null);
        await refreshStatusMessage(client);

        activeSession.updateTimer = setInterval(async () => {
            await refreshStatusMessage(client);
        }, 5 * 60 * 1000);

        activeSession.endTimer = setTimeout(async () => {
            await endSession(client);
        }, durationMinutes * 60 * 1000);
    }, 60 * 1000);

    await channel.send({ embeds: [startingEmbed] });
    return activeSession;
}

async function refreshStatusMessage(client) {
    if (!activeSession) return;
    const channel = await client.channels.fetch(activeSession.channelId).catch(() => null);
    if (!channel) return;

    try {
        const message = await channel.messages.fetch(activeSession.statusMessageId);
        await message.edit({
            embeds: [buildStatusEmbed(activeSession)],
            components: [buildSessionActionRow()]
        });
    } catch (error) {
        console.error('Failed to refresh session status message:', error);
    }
}

function joinSession(userId) {
    if (!activeSession) return false;
    activeSession.participants.add(userId);
    return true;
}

function leaveSession(userId) {
    if (!activeSession) return false;
    activeSession.participants.delete(userId);
    activeSession.confirmed.delete(userId);
    return true;
}

function confirmCompletion(userId) {
    if (!activeSession || !activeSession.participants.has(userId)) return false;
    activeSession.confirmed.add(userId);
    return true;
}

async function endSession(client) {
    if (!activeSession) return;

    const session = activeSession;
    const now = Date.now();
    const startTime = session.startTime || session.createdAt;
    const recordedMinutes = Math.max(1, Math.round((now - startTime) / 60000));

    const channel = await client.channels.fetch(session.channelId).catch(() => null);
    if (channel) {
        await channel.send({ embeds: [buildSessionSummaryEmbed(session, recordedMinutes)] }).catch(() => null);
    }

    session.participants.forEach((userId) => {
        const userData = storage.getUserData(userId);
        createUserSessionData(userData, recordedMinutes);
    });

    await storage.saveData();
    cleanupTimers();
    activeSession = null;
}

function cleanupTimers() {
    if (!activeSession) return;
    if (activeSession.countdownTimer) clearTimeout(activeSession.countdownTimer);
    if (activeSession.updateTimer) clearInterval(activeSession.updateTimer);
    if (activeSession.endTimer) clearTimeout(activeSession.endTimer);
}

module.exports = {
    getActiveSession,
    isSessionActive,
    startSession,
    joinSession,
    leaveSession,
    confirmCompletion,
    refreshStatusMessage
};
