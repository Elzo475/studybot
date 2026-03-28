const { buildStatusEmbed, buildSessionActionRow, buildSessionSummaryEmbed, buildInfoEmbed, formatDayKey } = require('./embeds');
const storage = require('./storage');

const activeSessions = new Map();

function generateSessionId() {
    let id;
    do {
        id = Math.floor(1000 + Math.random() * 9000).toString();
    } while (activeSessions.has(id));
    return id;
}

function getSession(sessionId) {
    return activeSessions.get(sessionId) || null;
}

function getAllSessions() {
    return Array.from(activeSessions.values());
}

function isSessionActive(sessionId) {
    return sessionId ? activeSessions.has(sessionId) : activeSessions.size > 0;
}

function isVoiceChannelInUse(channelId) {
    return getAllSessions().some(session => session.voiceChannelId === channelId);
}

function createUserSessionData(userData, minutes) {
    userData.sessions += 1;
    userData.totalStudyMinutes += minutes;
    userData.completedSessions += 1;
    userData.lastSessionAt = Date.now();
    const dayKey = formatDayKey();
    userData.dailyStudy[dayKey] = (userData.dailyStudy[dayKey] || 0) + minutes;
}

async function startSession({ client, textChannel, hostId, durationMinutes = 50, isPrivate = false, voiceChannelId = null, categoryId = null, cleanupCategory = false }) {
    const sessionId = generateSessionId();
    const sessionData = {
        id: sessionId,
        hostId,
        durationMinutes,
        isPrivate,
        voiceChannelId,
        categoryId,
        textChannelId: textChannel.id,
        participants: new Set([hostId]),
        confirmed: new Set(),
        pendingRequests: new Set(),
        createdAt: Date.now(),
        started: false,
        startTime: null,
        statusMessageId: null,
        countdownTimer: null,
        updateTimer: null,
        endTimer: null,
        cleanupCategory
    };

    const startingEmbed = buildInfoEmbed(
        '⏳ Focus Session Incoming',
        `Session **${sessionId}** will begin in 1 minute. Use the buttons below to join, leave, or confirm completion.`
    );

    const statusMessage = await textChannel.send({
        embeds: [buildStatusEmbed(sessionData)],
        components: [buildSessionActionRow(sessionId)]
    });

    sessionData.statusMessageId = statusMessage.id;
    activeSessions.set(sessionId, sessionData);

    sessionData.countdownTimer = setTimeout(async () => {
        const current = getSession(sessionId);
        if (!current) return;
        current.started = true;
        current.startTime = Date.now();

        const liveEmbed = buildInfoEmbed('🚀 Session Started', `Your focus session is live for ${durationMinutes} minutes. Stay on task and check back for progress updates.`);
        await textChannel.send({ embeds: [liveEmbed] }).catch(() => null);
        await refreshStatusMessage(client, sessionId);

        current.updateTimer = setInterval(async () => {
            await refreshStatusMessage(client, sessionId);
        }, 5 * 60 * 1000);

        current.endTimer = setTimeout(async () => {
            await endSession(client, sessionId);
        }, durationMinutes * 60 * 1000);
    }, 60 * 1000);

    await textChannel.send({ embeds: [startingEmbed] });
    return sessionData;
}

async function refreshStatusMessage(client, sessionId) {
    const session = getSession(sessionId);
    if (!session) return;

    const channel = await client.channels.fetch(session.textChannelId).catch(() => null);
    if (!channel) return;

    try {
        const message = await channel.messages.fetch(session.statusMessageId);
        await message.edit({
            embeds: [buildStatusEmbed(session)],
            components: [buildSessionActionRow(sessionId)]
        });
    } catch (error) {
        console.error('Failed to refresh session status message:', error);
    }
}

function joinSession(userId, sessionId) {
    const session = getSession(sessionId);
    if (!session) return false;
    session.participants.add(userId);
    session.pendingRequests.delete(userId);
    return true;
}

function leaveSession(userId, sessionId) {
    const session = getSession(sessionId);
    if (!session) return false;
    session.participants.delete(userId);
    session.confirmed.delete(userId);
    session.pendingRequests.delete(userId);
    return true;
}

function confirmCompletion(userId, sessionId) {
    const session = getSession(sessionId);
    if (!session || !session.participants.has(userId)) return false;
    session.confirmed.add(userId);
    return true;
}

function addJoinRequest(sessionId, userId) {
    const session = getSession(sessionId);
    if (!session || session.pendingRequests.has(userId)) return false;
    session.pendingRequests.add(userId);
    return true;
}

function approveJoinRequest(sessionId, userId) {
    const session = getSession(sessionId);
    if (!session || !session.pendingRequests.has(userId)) return false;
    session.pendingRequests.delete(userId);
    session.participants.add(userId);
    return true;
}

async function endSession(client, sessionId) {
    const session = getSession(sessionId);
    if (!session) return false;

    const now = Date.now();
    const startTime = session.startTime || session.createdAt;
    const recordedMinutes = Math.max(1, Math.round((now - startTime) / 60000));

    const channel = await client.channels.fetch(session.textChannelId).catch(() => null);
    if (channel) {
        await channel.send({ embeds: [buildSessionSummaryEmbed(session, recordedMinutes)] }).catch(() => null);
    }

    session.participants.forEach((userId) => {
        const userData = storage.getUserData(userId);
        createUserSessionData(userData, recordedMinutes);
    });

    await storage.saveData();
    cleanupTimers(sessionId);
    activeSessions.delete(sessionId);

    if (session.cleanupCategory && session.categoryId) {
        const category = await client.channels.fetch(session.categoryId).catch(() => null);
        if (category && category.delete) {
            await category.delete().catch(() => null);
        }
    }

    return true;
}

function cleanupTimers(sessionId) {
    const session = getSession(sessionId);
    if (!session) return;
    if (session.countdownTimer) clearTimeout(session.countdownTimer);
    if (session.updateTimer) clearInterval(session.updateTimer);
    if (session.endTimer) clearTimeout(session.endTimer);
}

module.exports = {
    getSession,
    getAllSessions,
    isSessionActive,
    isVoiceChannelInUse,
    startSession,
    refreshStatusMessage,
    joinSession,
    leaveSession,
    confirmCompletion,
    addJoinRequest,
    approveJoinRequest,
    endSession
};
