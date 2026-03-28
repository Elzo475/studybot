const { buildStatusEmbed, buildSessionActionRow, buildSessionSummaryEmbed, buildInfoEmbed, formatDayKey } = require('./embeds');
const storage = require('./storage');

const activeSessions = new Map();
const SESSION_PAUSE_EXPIRY_MS = 10 * 60 * 60 * 1000;
const CATEGORY_CLEANUP_DELAY_MS = 60 * 60 * 1000;
const categoryCleanupTimers = new Map();

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

function scheduleCategoryDeletion(client, categoryId, delay = CATEGORY_CLEANUP_DELAY_MS) {
    if (!categoryId || !client) return;
    const existing = categoryCleanupTimers.get(categoryId);
    if (existing) {
        clearTimeout(existing);
    }
    const timer = setTimeout(async () => {
        const category = await client.channels.fetch(categoryId).catch(() => null);
        if (category && category.delete) {
            await category.delete().catch(() => null);
        }
        categoryCleanupTimers.delete(categoryId);
    }, delay);
    categoryCleanupTimers.set(categoryId, timer);
}

async function cleanupExpiredPausedSessions(client) {
    const now = Date.now();
    const sessions = getAllSessions();
    for (const sessionData of sessions) {
        if (sessionData.paused && sessionData.pausedAt && now - sessionData.pausedAt >= SESSION_PAUSE_EXPIRY_MS) {
            await endSession(client, sessionData.id);
        } else if (!sessionData.started && now - sessionData.createdAt >= SESSION_PAUSE_EXPIRY_MS) {
            await endSession(client, sessionData.id);
        }
    }
}

function isSessionActive(sessionId) {
    return sessionId ? activeSessions.has(sessionId) : activeSessions.size > 0;
}

function isVoiceChannelInUse(channelId) {
    return getAllSessions().some(session => session.voiceChannelId === channelId);
}

function getUserSession(userId) {
    return getAllSessions().find(session => session.hostId === userId || session.participants.has(userId)) || null;
}

function createUserSessionData(userData, minutes) {
    userData.sessions += 1;
    userData.totalStudyMinutes += minutes;
    userData.completedSessions += 1;
    userData.lastSessionAt = Date.now();
    const dayKey = formatDayKey();
    userData.dailyStudy[dayKey] = (userData.dailyStudy[dayKey] || 0) + minutes;
}

function calculatePomodoroTotalMs(sets = []) {
    return sets.reduce((total, set) => {
        const study = Number(set.studyMinutes) || 0;
        const rest = Number(set.restMinutes) || 0;
        return total + study * 60 * 1000 + rest * 60 * 1000;
    }, 0);
}

async function startSession({ client, textChannel, hostId, durationMinutes = 50, isPrivate = false, voiceChannelId = null, categoryId = null, cleanupCategory = false, pomodoroSets = [] }) {
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
        phaseTimer: null,
        cleanupCategory,
        pomodoroSets,
        currentPomodoroIndex: 0,
        currentPhase: null,
        phaseStartAt: null,
        phaseRemainingMs: null,
        totalMs: null,
        remainingMs: null,
        paused: false,
        pausedAt: null,
        lastActiveAt: null
    };

    const startingEmbed = buildInfoEmbed(
        '⏳ Focus Session Incoming',
        `Session **${sessionId}** will begin in 1 minute. Use the buttons below to join, leave, pause, or confirm completion.`
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
        await beginSession(client, current);
    }, 60 * 1000);

    await textChannel.send({ embeds: [startingEmbed] });
    return sessionData;
}

async function beginSession(client, sessionData) {
    if (!sessionData || sessionData.started) return;
    sessionData.started = true;
    sessionData.startTime = Date.now();
    sessionData.lastActiveAt = Date.now();
    sessionData.paused = false;

    if (Array.isArray(sessionData.pomodoroSets) && sessionData.pomodoroSets.length > 0) {
        sessionData.totalMs = calculatePomodoroTotalMs(sessionData.pomodoroSets);
        sessionData.remainingMs = sessionData.totalMs;
        sessionData.currentPomodoroIndex = 0;
        sessionData.currentPhase = 'study';
        sessionData.phaseStartAt = Date.now();
        sessionData.phaseRemainingMs = (Number(sessionData.pomodoroSets[0].studyMinutes) || 0) * 60 * 1000;
        await runPomodoroPhase(client, sessionData.id);
    } else {
        sessionData.totalMs = sessionData.durationMinutes * 60 * 1000;
        sessionData.remainingMs = sessionData.totalMs;
        sessionData.phaseStartAt = Date.now();
        sessionData.phaseRemainingMs = sessionData.totalMs;
        sessionData.endTimer = setTimeout(async () => {
            await endSession(client, sessionData.id);
        }, sessionData.remainingMs);
        sessionData.updateTimer = setInterval(async () => {
            await refreshStatusMessage(client, sessionData.id);
        }, 5 * 60 * 1000);
        await refreshStatusMessage(client, sessionData.id);
        const liveEmbed = buildInfoEmbed('🚀 Session Started', `Your focus session is live for ${sessionData.durationMinutes} minutes. Stay on task and check back for progress updates.`);
        const channel = await client.channels.fetch(sessionData.textChannelId).catch(() => null);
        if (channel) channel.send({ embeds: [liveEmbed] }).catch(() => null);
    }
}

async function runPomodoroPhase(client, sessionId) {
    const sessionData = getSession(sessionId);
    if (!sessionData || sessionData.paused) return;

    const setIndex = sessionData.currentPomodoroIndex;
    if (setIndex >= sessionData.pomodoroSets.length) {
        return endSession(client, sessionId);
    }

    const set = sessionData.pomodoroSets[setIndex];
    const phase = sessionData.currentPhase || 'study';
    const durationMinutes = phase === 'study' ? Number(set.studyMinutes) || 0 : Number(set.restMinutes) || 0;
    const phaseLabel = phase === 'study' ? 'Study' : 'Rest';
    const channel = await client.channels.fetch(sessionData.textChannelId).catch(() => null);

    if (!channel) return;

    const phaseEmbed = buildInfoEmbed(
        `⏱️ Pomodoro ${phaseLabel} Time`,
        `Set ${setIndex + 1}: ${durationMinutes} minutes of ${phaseLabel.toLowerCase()}.

Keep going! Use the buttons below to pause, resume, or end the session.`
    );
    await channel.send({ embeds: [phaseEmbed] }).catch(() => null);

    sessionData.phaseStartAt = Date.now();
    sessionData.phaseRemainingMs = durationMinutes * 60 * 1000;
    sessionData.currentPhase = phase;
    sessionData.phaseTimer = setTimeout(async () => {
        sessionData.remainingMs = Math.max(0, sessionData.remainingMs - sessionData.phaseRemainingMs);
        if (phase === 'study' && Number(set.restMinutes) > 0) {
            sessionData.currentPhase = 'rest';
        } else {
            sessionData.currentPomodoroIndex += 1;
            sessionData.currentPhase = 'study';
        }
        await refreshStatusMessage(client, sessionId);
        await runPomodoroPhase(client, sessionId);
    }, sessionData.phaseRemainingMs);

    if (sessionData.updateTimer) {
        clearInterval(sessionData.updateTimer);
    }
    sessionData.updateTimer = setInterval(async () => {
        await refreshStatusMessage(client, sessionId);
    }, 5 * 60 * 1000);
}
async function refreshStatusMessage(client, sessionId) {
    const session = getSession(sessionId);
    if (!session || !session.textChannelId || !session.statusMessageId) return false;

    const channel = await client.channels.fetch(session.textChannelId).catch(() => null);
    if (!channel || !channel.isTextBased?.() || !channel.messages) return false;

    const message = await channel.messages.fetch(session.statusMessageId).catch(() => null);
    if (!message) return false;

    await message.edit({
        embeds: [buildStatusEmbed(session)],
        components: [buildSessionActionRow(sessionId)]
    }).catch(() => null);

    return true;
}
function pauseSession(sessionId) {
    const session = getSession(sessionId);
    if (!session || !session.started || session.paused) return false;

    session.paused = true;
    session.pausedAt = Date.now();
    session.lastActiveAt = Date.now();

    if (session.phaseTimer) {
        clearTimeout(session.phaseTimer);
        const elapsed = Date.now() - session.phaseStartAt;
        session.phaseRemainingMs = Math.max(0, session.phaseRemainingMs - elapsed);
    }

    if (session.endTimer) {
        clearTimeout(session.endTimer);
        const elapsed = Date.now() - session.phaseStartAt;
        session.remainingMs = Math.max(0, session.remainingMs - elapsed);
    }

    if (session.updateTimer) {
        clearInterval(session.updateTimer);
    }

    return true;
}

async function resumeSession(client, sessionId) {
    const sessionData = getSession(sessionId);
    if (!sessionData || !sessionData.started || !sessionData.paused) return false;
    if (Date.now() - sessionData.pausedAt > 10 * 60 * 60 * 1000) {
        await endSession(client, sessionId);
        return false;
    }

    sessionData.paused = false;
    sessionData.lastActiveAt = Date.now();
    sessionData.phaseStartAt = Date.now();

    if (Array.isArray(sessionData.pomodoroSets) && sessionData.pomodoroSets.length > 0) {
        sessionData.phaseTimer = setTimeout(async () => {
            sessionData.remainingMs = Math.max(0, sessionData.remainingMs - sessionData.phaseRemainingMs);
            const currentSet = sessionData.pomodoroSets[sessionData.currentPomodoroIndex];
            if (sessionData.currentPhase === 'study' && Number(currentSet.restMinutes) > 0) {
                sessionData.currentPhase = 'rest';
            } else {
                sessionData.currentPomodoroIndex += 1;
                sessionData.currentPhase = 'study';
            }
            await refreshStatusMessage(client, sessionId);
            await runPomodoroPhase(client, sessionId);
        }, sessionData.phaseRemainingMs);
    } else {
        sessionData.endTimer = setTimeout(async () => {
            await endSession(client, sessionId);
        }, sessionData.remainingMs);
    }

    if (sessionData.updateTimer) {
        clearInterval(sessionData.updateTimer);
    }
    sessionData.updateTimer = setInterval(async () => {
        await refreshStatusMessage(client, sessionId);
    }, 5 * 60 * 1000);

    await refreshStatusMessage(client, sessionId);
    return true;
}

function modifySession(sessionId, updates) {
    const session = getSession(sessionId);
    if (!session) return false;
    if (session.started && !session.paused) return false;

    if (Array.isArray(updates.pomodoroSets)) {
        session.pomodoroSets = updates.pomodoroSets;
        session.totalMs = calculatePomodoroTotalMs(session.pomodoroSets);
        session.durationMinutes = Math.round(session.totalMs / 60000);
        session.remainingMs = session.totalMs;
        session.currentPomodoroIndex = 0;
        session.currentPhase = 'study';
        session.phaseRemainingMs = (Number(session.pomodoroSets[0]?.studyMinutes) || 0) * 60 * 1000;
    }
    if (typeof updates.durationMinutes === 'number' && updates.durationMinutes > 0) {
        session.durationMinutes = updates.durationMinutes;
        if (!Array.isArray(session.pomodoroSets) || !session.pomodoroSets.length) {
            session.totalMs = session.durationMinutes * 60 * 1000;
            session.remainingMs = session.totalMs;
            session.phaseRemainingMs = session.totalMs;
        }
    }
    if (typeof updates.isPrivate === 'boolean') {
        session.isPrivate = updates.isPrivate;
    }

    return true;
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
        scheduleCategoryDeletion(client, session.categoryId);
    }

    return true;
}

function cleanupTimers(sessionId) {
    const session = getSession(sessionId);
    if (!session) return;
    if (session.countdownTimer) clearTimeout(session.countdownTimer);
    if (session.updateTimer) clearInterval(session.updateTimer);
    if (session.endTimer) clearTimeout(session.endTimer);
    if (session.phaseTimer) clearTimeout(session.phaseTimer);
}

module.exports = {
    getSession,
    getAllSessions,
    isSessionActive,
    isVoiceChannelInUse,
    getUserSession,
    startSession,
    refreshStatusMessage,
    joinSession,
    leaveSession,
    confirmCompletion,
    addJoinRequest,
    approveJoinRequest,
    endSession,
    pauseSession,
    resumeSession,
    modifySession,
    cleanupExpiredPausedSessions
};
