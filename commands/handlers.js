const { ChannelType } = require('discord.js');
const storage = require('../utils/storage');
const session = require('../utils/session');
const embeds = require('../utils/embeds');

const PREMIUM_ROLE = 'Premium';
const STREAK_ROLES = {
    3: '🔥 Consistent',
    7: '💪 Disciplined',
    30: '👑 Elite'
};

function isPremium(member) {
    return member && member.roles.cache.some(role => role.name === PREMIUM_ROLE);
}

function parseMetaSections(rawText) {
    const result = { text: rawText, dueDate: null, description: null };
    const byMatch = rawText.match(/\/by\s+([^\/]+)/i);
    const descMatch = rawText.match(/\/desc\s+([^\/]+)/i);

    if (byMatch) {
        result.dueDate = byMatch[1].trim();
        result.text = result.text.replace(byMatch[0], '').trim();
    }
    if (descMatch) {
        result.description = descMatch[1].trim();
        result.text = result.text.replace(descMatch[0], '').trim();
    }

    result.text = result.text.replace(/\s{2,}/g, ' ').trim();
    return result;
}

function parseReminderTime(value) {
    const durationMatch = value.match(/^(\d+)([smhd])$/i);
    if (durationMatch) {
        const amount = parseInt(durationMatch[1], 10);
        const unit = durationMatch[2].toLowerCase();
        const now = Date.now();
        if (unit === 's') return now + amount * 1000;
        if (unit === 'm') return now + amount * 60 * 1000;
        if (unit === 'h') return now + amount * 60 * 60 * 1000;
        if (unit === 'd') return now + amount * 24 * 60 * 60 * 1000;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
        return parsed;
    }
    return null;
}

function extractMentionId(token) {
    const mentionMatch = token.match(/^<@!?(\d+)>$/);
    return mentionMatch ? mentionMatch[1] : token;
}

function getPomodoroTotalMinutes(sets = []) {
    return sets.reduce((sum, set) => {
        const study = Number(set.studyMinutes) || 0;
        const rest = Number(set.restMinutes) || 0;
        return sum + study + rest;
    }, 0);
}

function formatPomodoroSets(sets = []) {
    if (!sets.length) return 'No pomodoro sets configured yet.';
    return sets.map((set, index) => `Set ${index + 1}: ${set.studyMinutes} min study / ${set.restMinutes} min rest`).join('\n');
}

async function awardStreakReward(member, userData, message) {
    if (!member) return;
    const streak = userData.streak;
    const roleName = STREAK_ROLES[streak];

    if (!roleName) return;
    const badgeText = `🎉 You reached a ${streak}-day streak and earned the **${roleName}** reward!`;
    const role = message.guild.roles.cache.find(r => r.name === roleName);

    if (role && !member.roles.cache.has(role.id)) {
        try {
            await member.roles.add(role);
            return message.reply({ embeds: [embeds.buildInfoEmbed('Role Reward Unlocked', `${badgeText} The server role has been assigned.`)] });
        } catch (error) {
            console.error('Streak role assignment failed:', error);
            return message.reply({ embeds: [embeds.buildInfoEmbed('Role Reward', `${badgeText} (Could not assign role automatically.)`)] });
        }
    }

    return message.reply({ embeds: [embeds.buildInfoEmbed('Streak Milestone', `${badgeText}`)] });
}

async function handleGoalCommand(message, args) {
    const raw = args.join(' ').trim();
    if (!raw) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a goal after `!goal`.')] });
    }

    const goalEntry = parseMetaSections(raw);
    storage.setGoal(message.author.id, {
        goal: goalEntry.text,
        dueDate: goalEntry.dueDate,
        description: goalEntry.description
    });

    const description = [`🎯 Goal saved: **${goalEntry.text}**`];
    if (goalEntry.dueDate) description.push(`📅 Due by: ${goalEntry.dueDate}`);
    if (goalEntry.description) description.push(`📝 ${goalEntry.description}`);

    return message.reply({ embeds: [embeds.buildInfoEmbed('Goal Set', description.join('\n'))] });
}

async function handleDoneCommand(message) {
    const goal = storage.getGoal(message.author.id);
    if (!goal) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You currently have no active goal.')] });
    }

    storage.clearGoal(message.author.id);
    return message.reply({ embeds: [embeds.buildInfoEmbed('Goal Completed', '🔥 Nicely done! Your goal has been marked complete.')] });
}

async function handleCheckinCommand(message) {
    const userId = message.author.id;
    const now = Date.now();
    const userData = storage.getUserData(userId);
    const last = userData.lastCheckin;
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (last && now - last < ONE_DAY) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You have already checked in today. Come back tomorrow for another streak update.')] });
    }

    if (last && now - last < ONE_DAY * 2) {
        userData.streak += 1;
    } else {
        userData.streak = 1;
    }

    userData.checkins += 1;
    userData.lastCheckin = now;
    await storage.saveData();

    const streakReply = `✅ Check-in complete!\n📈 Total check-ins: ${userData.checkins}\n🔥 Current streak: ${userData.streak} days`;
    await message.reply({ embeds: [embeds.buildInfoEmbed('Daily Check-in', streakReply)] });

    if (STREAK_ROLES[userData.streak]) {
        await awardStreakReward(message.member, userData, message);
    }
}

async function createPrivateRoom(message, client) {
    const category = await message.guild.channels.create({
        name: `${message.author.username}'s Study Space`,
        type: ChannelType.GuildCategory,
        permissionOverwrites: [
            {
                id: message.guild.roles.everyone.id,
                deny: ['ViewChannel', 'Connect', 'SendMessages']
            },
            {
                id: message.author.id,
                allow: ['ViewChannel', 'Connect', 'SendMessages', 'ManageChannels']
            }
        ]
    });

    const voiceChannel = await message.guild.channels.create({
        name: 'Study Voice',
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: category.permissionOverwrites.cache.map(overwrite => ({
            id: overwrite.id,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield
        }))
    });

    const textChannel = await message.guild.channels.create({
        name: 'study-chat',
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: category.permissionOverwrites.cache.map(overwrite => ({
            id: overwrite.id,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield
        }))
    });

    return {
        categoryId: category.id,
        voiceChannelId: voiceChannel.id,
        textChannelId: textChannel.id
    };
}

async function resolveVoiceChannel(message, token) {
    if (!token) {
        return message.member.voice.channel || null;
    }

    const cleaned = extractMentionId(token);
    const byId = message.guild.channels.cache.get(cleaned);
    if (byId && byId.type === ChannelType.GuildVoice) return byId;

    return message.guild.channels.cache.find(channel => channel.type === ChannelType.GuildVoice && channel.name.toLowerCase() === token.toLowerCase()) || null;
}

async function handleCreateVCCommand(message) {
    const userData = storage.getUserData(message.author.id);
    if (userData.privateCategoryId) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You already have a private study room. Use `!deleteroom` to remove it first.')] });
    }

    try {
        const created = await createPrivateRoom(message);
        userData.privateCategoryId = created.categoryId;
        userData.privateVcId = created.voiceChannelId;
        userData.privateTextId = created.textChannelId;
        userData.privateCategoryCreatedAt = Date.now();
        userData.privateCategoryLastActive = Date.now();
        await storage.saveData();

        return message.reply({ embeds: [embeds.buildInfoEmbed('Private Room Created', `🎧 Your private room is ready: <#${created.voiceChannelId}> and <#${created.textChannelId}>`)] });
    } catch (error) {
        console.error('Create private room failed:', error);
        return message.reply({ embeds: [embeds.buildErrorEmbed('Failed to create your private study room.')] });
    }
}

async function handleDeleteVCCommand(message) {
    const userData = storage.getUserData(message.author.id);
    const category = userData.privateCategoryId ? message.guild.channels.cache.get(userData.privateCategoryId) : null;
    if (!category) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You do not have a private study room.') ]});
    }

    await category.delete().catch(() => null);
    userData.privateCategoryId = null;
    userData.privateVcId = null;
    userData.privateTextId = null;
    userData.privateCategoryCreatedAt = 0;
    userData.privateCategoryLastActive = 0;
    await storage.saveData();

    return message.reply({ embeds: [embeds.buildInfoEmbed('Private Room Removed', '🗑️ Your private study room has been removed.')] });
}

async function handleRenameVCCommand(message, args) {
    const newName = args.join(' ').trim();
    if (!newName) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a new name after `!renameroom`.')] });
    }

    const userData = storage.getUserData(message.author.id);
    const category = userData.privateCategoryId ? message.guild.channels.cache.get(userData.privateCategoryId) : null;
    if (!category) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You do not have a private study room.') ]});
    }

    await category.setName(newName).catch(() => null);
    return message.reply({ embeds: [embeds.buildInfoEmbed('Room Renamed', `✏️ Your private study room has been renamed to **${newName}**.`)] });
}

async function handleStartSessionCommand(message, args, client) {
    const existingSession = session.getUserSession(message.author.id);
    if (existingSession) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You are already in an active session. You must finish or pause it before starting a new one.')] });
    }

    const userData = storage.getUserData(message.author.id);
    const durationArg = args.find(arg => !isNaN(parseInt(arg, 10)));
    let duration = durationArg ? Math.min(Math.max(parseInt(durationArg, 10), 10), 180) : 50;
    const privateFlag = args.some(arg => arg.toLowerCase() === 'private');
    const publicFlag = args.some(arg => arg.toLowerCase() === 'public');
    const pomodoroFlag = args.some(arg => ['pomodoro', 'pomo'].includes(arg.toLowerCase()));
    const voiceArgIndex = args.findIndex(arg => arg.toLowerCase() === 'public');
    let voiceChannel = null;
    let cleanupCategory = false;
    let categoryId = null;
    let textChannel = message.channel;
    let pomodoroSets = [];

    if (pomodoroFlag) {
        pomodoroSets = Array.isArray(userData.pomodoroSets) ? userData.pomodoroSets : [];
        if (!pomodoroSets.length) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('You have no pomodoro sets configured. Use `!pomodoro add <studyMinutes> <restMinutes>` to create them first.')] });
        }
        duration = pomodoroSets.reduce((sum, set) => sum + (Number(set.studyMinutes) || 0) + (Number(set.restMinutes) || 0), 0);
    }

    if (privateFlag) {
        if (userData.privateCategoryId && userData.privateTextId && userData.privateVcId) {
            textChannel = await client.channels.fetch(userData.privateTextId).catch(() => textChannel);
            voiceChannel = await client.channels.fetch(userData.privateVcId).catch(() => null);
            categoryId = userData.privateCategoryId;
            userData.privateCategoryLastActive = Date.now();
            await storage.saveData();
        } else {
            const created = await createPrivateRoom(message, client);
            textChannel = await client.channels.fetch(created.textChannelId).catch(() => textChannel);
            voiceChannel = await client.channels.fetch(created.voiceChannelId).catch(() => null);
            categoryId = created.categoryId;
            cleanupCategory = true;
        }
    }

    if (publicFlag) {
        const voiceToken = args[voiceArgIndex + 1];
        voiceChannel = await resolveVoiceChannel(message, voiceToken);
        if (!voiceChannel) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Please specify a valid public voice channel or join one before starting a session.')] });
        }
        if (session.isVoiceChannelInUse(voiceChannel.id)) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('That voice channel is already used by another active session.')] });
        }
    }

    const sessionData = await session.startSession({
        client,
        textChannel,
        hostId: message.author.id,
        durationMinutes: duration,
        isPrivate: privateFlag,
        voiceChannelId: voiceChannel ? voiceChannel.id : null,
        categoryId,
        cleanupCategory,
        pomodoroSets
    }).catch(error => {
        console.error('Session start failure:', error);
        return null;
    });

    if (!sessionData) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Unable to start the session. Try again later.')] });
    }

    const infoLines = [`✅ Session **${sessionData.id}** is starting in 1 minute.`];
    if (privateFlag) infoLines.push('Your private session is ready. Invite members with `!invite <sessionId> @user`.');
    if (voiceChannel) infoLines.push(`Voice channel: <#${voiceChannel.id}>`);
    if (pomodoroFlag) infoLines.push('Pomodoro flow is enabled for this session.');

    return message.reply({ embeds: [embeds.buildInfoEmbed('Session Ready', infoLines.join('\n'))] });
}

async function handleJoinCommand(message, args, client) {
    const sessionId = args[0];
    if (!sessionId) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a session ID after `!join`.')] });
    }

    const active = session.getSession(sessionId);
    if (!active) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Session not found. Check your session ID and try again.')] });
    }

    if (active.isPrivate && !active.participants.has(message.author.id)) {
        if (active.pendingRequests.has(message.author.id)) {
            return message.reply({ embeds: [embeds.buildInfoEmbed('Request Pending', '✅ Your request to join has already been sent to the host.')] });
        }

        active.pendingRequests.add(message.author.id);
        const host = await message.guild.members.fetch(active.hostId).catch(() => null);
        const requestText = `<@${message.author.id}> requested access to private session **${active.id}**.`;

        if (host) {
            host.send(requestText).catch(() => null);
        }
        const sessionChannel = await client.channels.fetch(active.textChannelId).catch(() => null);
        if (sessionChannel) {
            sessionChannel.send(requestText).catch(() => null);
        }

        return message.reply({ embeds: [embeds.buildInfoEmbed('Request Sent', '✅ The host has been notified. Use `!invite <sessionId> @user` to allow access.')] });
    }

    const joined = session.joinSession(message.author.id, sessionId);
    if (!joined) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Unable to join the session.')] });
    }

    return message.reply({ embeds: [embeds.buildInfoEmbed('Session Joined', `✅ You joined session **${sessionId}**.`)] });
}

async function handleInviteCommand(message, args, client) {
    const sessionId = args[0];
    const userToken = args[1];
    if (!sessionId || !userToken) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Usage: !invite <sessionId> @user')] });
    }

    const active = session.getSession(sessionId);
    if (!active) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Session not found.')] });
    }

    if (active.hostId !== message.author.id) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Only the session host can invite users.')] });
    }

    const inviteeId = extractMentionId(userToken);
    const invitee = await message.guild.members.fetch(inviteeId).catch(() => null);
    if (!invitee) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Could not find that user in the server.')] });
    }

    session.joinSession(inviteeId, sessionId);

    if (active.categoryId) {
        const category = await client.channels.fetch(active.categoryId).catch(() => null);
        if (category && category.children) {
            await Promise.all(category.children.map(channel => channel.permissionOverwrites.edit(inviteeId, {
                ViewChannel: true,
                Connect: true,
                SendMessages: true
            }).catch(() => null)));
        }
    }

    return message.reply({ embeds: [embeds.buildInfoEmbed('Invite Sent', `✅ <@${inviteeId}> has been invited to session **${sessionId}**.`)] });
}

async function handleStatusCommand(message, args) {
    const sessionId = args[0] || null;
    let active = null;

    if (sessionId) {
        active = session.getSession(sessionId);
    } else {
        active = session.getAllSessions().find(s => s.textChannelId === message.channel.id);
    }

    if (!active) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('No session status found for this channel or ID.')] });
    }

    return message.reply({ embeds: [embeds.buildStatusEmbed(active)] });
}

async function handlePomodoroCommand(message, args, client) {
    const userId = message.author.id;
    const userData = storage.getUserData(userId);
    const action = args[0] ? args[0].toLowerCase() : 'help';

    if (action === 'list' || action === 'show') {
        const sets = Array.isArray(userData.pomodoroSets) ? userData.pomodoroSets : [];
        return message.reply({ embeds: [embeds.buildInfoEmbed('Pomodoro Sets', formatPomodoroSets(sets))] });
    }

    if (action === 'add') {
        const study = Number(args[1]);
        const rest = Number(args[2]);
        if (!study || !rest) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Usage: !pomodoro add <studyMinutes> <restMinutes>')] });
        }
        userData.pomodoroSets = userData.pomodoroSets || [];
        userData.pomodoroSets.push({ studyMinutes: study, restMinutes: rest });
        await storage.saveData();
        return message.reply({ embeds: [embeds.buildInfoEmbed('Pomodoro Set Added', `✅ Set ${userData.pomodoroSets.length} configured for ${study}m study / ${rest}m rest.`)] });
    }

    if (action === 'remove') {
        const index = Number(args[1]) - 1;
        if (!Number.isInteger(index) || index < 0 || !userData.pomodoroSets?.[index]) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Usage: !pomodoro remove <setNumber>')] });
        }
        const removed = userData.pomodoroSets.splice(index, 1)[0];
        await storage.saveData();
        return message.reply({ embeds: [embeds.buildInfoEmbed('Pomodoro Set Removed', `🗑️ Removed set ${index + 1}: ${removed.studyMinutes}m study / ${removed.restMinutes}m rest.`)] });
    }

    if (action === 'update') {
        const index = Number(args[1]) - 1;
        const study = Number(args[2]);
        const rest = Number(args[3]);
        if (!Number.isInteger(index) || index < 0 || !userData.pomodoroSets?.[index] || !study || !rest) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Usage: !pomodoro update <setNumber> <studyMinutes> <restMinutes>')] });
        }
        userData.pomodoroSets[index] = { studyMinutes: study, restMinutes: rest };
        await storage.saveData();
        return message.reply({ embeds: [embeds.buildInfoEmbed('Pomodoro Set Updated', `✅ Set ${index + 1} now uses ${study}m study / ${rest}m rest.`)] });
    }

    if (action === 'clear') {
        userData.pomodoroSets = [];
        await storage.saveData();
        return message.reply({ embeds: [embeds.buildInfoEmbed('Pomodoro Cleared', 'All pomodoro sets have been removed.')] });
    }

    if (action === 'start') {
        return handleStartSessionCommand(message, [...args.slice(1), 'pomodoro'], client);
    }

    return message.reply({ embeds: [embeds.buildInfoEmbed('Pomodoro Commands', '**!pomodoro list** • Show current sets\n**!pomodoro add <study> <rest>** • Add a new set\n**!pomodoro update <setNumber> <study> <rest>** • Change an existing set\n**!pomodoro remove <setNumber>** • Remove a set\n**!pomodoro clear** • Clear all sets\n**!pomodoro start [private|public]** • Start a pomodoro session using your configured sets')] });
}

async function handleSessionCommand(message, args, client) {
    const userId = message.author.id;
    const action = args[0] ? args[0].toLowerCase() : 'help';
    const targetId = args[1] && !['duration', 'private', 'public'].includes(args[1].toLowerCase()) ? args[1] : null;
    const sessionId = targetId || session.getUserSession(userId)?.id;
    const active = sessionId ? session.getSession(sessionId) : null;

    if (action === 'help' || !action || ['help', 'commands'].includes(action)) {
        return message.reply({ embeds: [embeds.buildInfoEmbed('Session Commands', '**!session status [id]** • Get current session status\n**!session pause [id]** • Pause your session\n**!session resume [id]** • Resume a paused session\n**!session cancel [id]** • Cancel an active session\n**!session restart [id]** • Restart the session\n**!session modify [id] duration <minutes>** • Update the session duration\n**!session list** • List active sessions')] });
    }

    if (action === 'list') {
        const activeSessions = session.getAllSessions();
        if (!activeSessions.length) {
            return message.reply({ embeds: [embeds.buildInfoEmbed('Active Sessions', 'There are no active sessions right now.')] });
        }
        const lines = activeSessions.map(item => `**${item.id}** • Host: <@${item.hostId}> • Participants: ${item.participants.size} • ${item.isPrivate ? 'Private' : 'Public'}`).join('\n');
        return message.reply({ embeds: [embeds.buildInfoEmbed('Active Sessions', lines)] });
    }

    if (action === 'status') {
        const target = sessionId ? session.getSession(sessionId) : session.getUserSession(userId);
        if (!target) return message.reply({ embeds: [embeds.buildErrorEmbed('No active session found for you or that ID.')] });
        return message.reply({ embeds: [embeds.buildStatusEmbed(target)] });
    }

    if (!active) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Session not found. Provide a valid session ID or use your active session.')] });
    }

    const isHost = active.hostId === userId;
    if (['pause', 'resume', 'cancel', 'restart', 'modify'].includes(action) && !isHost) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Only the session host can change the session state.')] });
    }

    if (action === 'pause') {
        const paused = session.pauseSession(active.id);
        if (!paused) return message.reply({ embeds: [embeds.buildErrorEmbed('Unable to pause the session. It may already be paused or finished.')] });
        return message.reply({ embeds: [embeds.buildInfoEmbed('Session Paused', `Session **${active.id}** is paused. Resume within 10 hours or it will be cleared automatically.`)] });
    }

    if (action === 'resume') {
        const resumed = await session.resumeSession(client, active.id);
        if (!resumed) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Unable to resume the session. It may have expired or already ended.')] });
        }
        return message.reply({ embeds: [embeds.buildInfoEmbed('Session Resumed', `Session **${active.id}** is back on track.`)] });
    }

    if (action === 'cancel') {
        await session.endSession(client, active.id);
        return message.reply({ embeds: [embeds.buildInfoEmbed('Session Cancelled', `Session **${active.id}** has been cancelled and cleaned up.`)] });
    }

    if (action === 'restart') {
        const copied = {
            client,
            textChannel: await client.channels.fetch(active.textChannelId).catch(() => null),
            hostId: active.hostId,
            durationMinutes: active.durationMinutes,
            isPrivate: active.isPrivate,
            voiceChannelId: active.voiceChannelId,
            categoryId: active.categoryId,
            cleanupCategory: active.cleanupCategory,
            pomodoroSets: active.pomodoroSets || []
        };
        await session.endSession(client, active.id);
        if (!copied.textChannel) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Unable to restart because the original text channel is unavailable.')] });
        }
        const newSession = await session.startSession(copied).catch(() => null);
        if (!newSession) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Failed to restart the session.')] });
        }
        return message.reply({ embeds: [embeds.buildInfoEmbed('Session Restarted', `Session **${newSession.id}** has been created with the same settings.`)] });
    }

    if (action === 'modify') {
        const modifier = args[targetId ? 2 : 1]?.toLowerCase();
        const value = args[targetId ? 3 : 2];
        if (modifier !== 'duration' || !value || Number.isNaN(Number(value))) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Usage: !session modify <id> duration <minutes>')] });
        }
        const updated = session.modifySession(active.id, { durationMinutes: Number(value) });
        if (!updated) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Unable to modify the session. It may already be active or paused.')] });
        }
        return message.reply({ embeds: [embeds.buildInfoEmbed('Session Updated', `Session **${active.id}** duration set to ${value} minutes.`)] });
    }

    return message.reply({ embeds: [embeds.buildErrorEmbed('Unknown session command. Use `!session help` for available options.')] });
}

async function handleEndSessionCommand(message, args, client) {
    const sessionId = args[0];
    if (!sessionId) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a session ID after `!endsession`.')] });
    }

    const active = session.getSession(sessionId);
    if (!active) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Session not found.')] });
    }

    if (active.hostId !== message.author.id) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Only the session host can end this session.')] });
    }

    await session.endSession(client, sessionId);
    return message.reply({ embeds: [embeds.buildInfoEmbed('Session Ended', `Session **${sessionId}** has been ended and study time recorded.`)] });
}

async function handleStatsCommand(message) {
    const userId = message.author.id;
    const userData = storage.getUserData(userId);
    const allUsers = Object.entries(storage.data).sort((a, b) => (b[1].totalStudyMinutes || 0) - (a[1].totalStudyMinutes || 0));
    const rank = allUsers.findIndex(entry => entry[0] === userId) + 1;

    return message.reply({ embeds: [embeds.buildStatsEmbed(message.author, userData, rank)] });
}

async function handleLeaderboardCommand(message) {
    const allUsers = Object.entries(storage.data).map(([userId, userData]) => ({
        userId,
        userData,
        weekly: embeds.getPeriodMinutes(userData.dailyStudy, 7),
        monthly: embeds.getPeriodMinutes(userData.dailyStudy, 30)
    }));
    const sorted = allUsers
        .sort((a, b) => (b.userData.streak || 0) - (a.userData.streak || 0));

    return message.reply({
        embeds: [embeds.buildLeaderboardEmbed('streaks', sorted, message.author.id)],
        components: [embeds.buildLeaderboardActionRow()]
    });
}

async function handleLeaderboardInteraction(interaction) {
    const category = interaction.customId.replace('leaderboard_', '');
    const allUsers = Object.entries(storage.data).map(([userId, userData]) => ({
        userId,
        userData,
        weekly: embeds.getPeriodMinutes(userData.dailyStudy, 7),
        monthly: embeds.getPeriodMinutes(userData.dailyStudy, 30)
    }));

    const sorted = allUsers.sort((a, b) => {
        if (category === 'streaks') return (b.userData.streak || 0) - (a.userData.streak || 0);
        if (category === 'alltime') return (b.userData.totalStudyMinutes || 0) - (a.userData.totalStudyMinutes || 0);
        if (category === 'weekly') return (b.weekly || 0) - (a.weekly || 0);
        if (category === 'monthly') return (b.monthly || 0) - (a.monthly || 0);
        return 0;
    });

    await interaction.update({
        embeds: [embeds.buildLeaderboardEmbed(category, sorted, interaction.user.id)],
        components: [embeds.buildLeaderboardActionRow()]
    });
}

async function handleTaskCommand(message, args) {
    const action = args[0] ? args[0].toLowerCase() : 'list';
    const userId = message.author.id;

    if (action === 'list') {
        const tasks = storage.listTasks(userId);
        return message.reply({ embeds: [embeds.buildTaskListEmbed(tasks, message.author.username)] });
    }

    if (action === 'add') {
        const raw = args.slice(1).join(' ').trim();
        if (!raw) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a task after `!task add`.')] });
        }

        const parsed = parseMetaSections(raw);
        const task = storage.addTask(userId, {
            title: parsed.text,
            description: parsed.description,
            dueDate: parsed.dueDate
        });

        return message.reply({ embeds: [embeds.buildInfoEmbed('Task Added', `✅ Task **${task.title}** has been added.`)] });
    }

    if (action === 'done' || action === 'remove') {
        const taskId = args[1];
        if (!taskId) {
            return message.reply({ embeds: [embeds.buildErrorEmbed(`Usage: !task ${action} <id>`)] });
        }

        if (action === 'done') {
            const task = storage.getTask(userId, taskId);
            if (!task) return message.reply({ embeds: [embeds.buildErrorEmbed('Task not found.')] });
            storage.updateTask(userId, taskId, { completed: true });
            return message.reply({ embeds: [embeds.buildInfoEmbed('Task Completed', `✅ Task **${task.title}** is now marked done.`)] });
        }

        const removed = storage.removeTask(userId, taskId);
        if (!removed) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Task not found.')] });
        }
        return message.reply({ embeds: [embeds.buildInfoEmbed('Task Removed', `🗑️ Task **${taskId}** has been deleted.`)] });
    }

    return message.reply({ embeds: [embeds.buildErrorEmbed('Unknown task command. Use `!task list`, `!task add`, `!task done`, or `!task remove`.')] });
}

async function handleReminderCommand(message, args) {
    const action = args[0] ? args[0].toLowerCase() : 'list';
    const userId = message.author.id;

    if (action === 'list') {
        const reminders = storage.listReminders(userId);
        return message.reply({ embeds: [embeds.buildReminderListEmbed(reminders, message.author.username)] });
    }

    if (action === 'remove') {
        const reminderId = args[1];
        if (!reminderId) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a reminder ID to remove.')] });
        }
        const removed = storage.removeReminder(userId, reminderId);
        if (!removed) return message.reply({ embeds: [embeds.buildErrorEmbed('Reminder not found.')] });
        return message.reply({ embeds: [embeds.buildInfoEmbed('Reminder Removed', `🗑️ Reminder **${reminderId}** has been removed.`)] });
    }

    if (action === 'add') {
        const when = args[1];
        const text = args.slice(2).join(' ').trim();
        if (!when || !text) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Usage: !reminder add <duration|date> <message>')] });
        }

        const dueAt = parseReminderTime(when);
        if (!dueAt || dueAt <= Date.now()) {
            return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a valid future duration or date. Example: `30m` or `2026-04-01T18:00`.')] });
        }

        const reminder = storage.addReminder(userId, { text, dueAt });
        return message.reply({ embeds: [embeds.buildInfoEmbed('Reminder Set', `⏰ I will remind you on <t:${Math.floor(reminder.dueAt / 1000)}:f> about:
${text}`)] });
    }

    return message.reply({ embeds: [embeds.buildErrorEmbed('Unknown reminder command. Use `!reminder add`, `!reminder list`, or `!reminder remove`.')] });
}

module.exports = {
    isPremium,
    awardStreakReward,
    handleGoalCommand,
    handleDoneCommand,
    handleCheckinCommand,
    handleStartSessionCommand,
    handleJoinCommand,
    handleInviteCommand,
    handleStatusCommand,
    handleEndSessionCommand,
    handleStatsCommand,
    handleLeaderboardCommand,
    handleLeaderboardInteraction,
    handleCreateVCCommand,
    handleDeleteVCCommand,
    handleRenameVCCommand,
    handlePomodoroCommand,
    handleSessionCommand,
    handleTaskCommand,
    handleReminderCommand
};
