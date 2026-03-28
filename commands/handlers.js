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
        return message.reply({ embeds: [embeds.buildErrorEmbed('You already have a private study room. Use `!deletevc` to remove it first.')] });
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
        return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a new name after `!renamevc`.')] });
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
    const userData = storage.getUserData(message.author.id);
    const durationArg = args.find(arg => !isNaN(parseInt(arg, 10)));
    const duration = durationArg ? Math.min(Math.max(parseInt(durationArg, 10), 10), 180) : 50;
    const privateFlag = args.some(arg => arg.toLowerCase() === 'private');
    const publicFlag = args.some(arg => arg.toLowerCase() === 'public');
    const voiceArgIndex = args.findIndex(arg => arg.toLowerCase() === 'public');
    let voiceChannel = null;
    let cleanupCategory = false;
    let categoryId = null;
    let textChannel = message.channel;

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
        cleanupCategory
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
    const allUsers = Object.entries(storage.data).map(([userId, userData]) => ({ userId, userData }));
    const sorted = allUsers
        .sort((a, b) => (b.userData.streak || 0) - (a.userData.streak || 0))
        .map(item => [item.userId, item.userData]);

    return message.reply({
        embeds: [embeds.buildLeaderboardEmbed('streaks', sorted, message.author.id)],
        components: [embeds.buildLeaderboardActionRow()]
    });
}

async function handleLeaderboardInteraction(interaction) {
    const category = interaction.customId.replace('leaderboard_', '');
    const allEntries = Object.entries(storage.data).map(([userId, userData]) => ({ userId, userData }));
    const processed = allEntries.map(({ userId, userData }) => {
        const weekly = embeds.getPeriodMinutes(userData.dailyStudy, 7);
        const monthly = embeds.getPeriodMinutes(userData.dailyStudy, 30);
        return [userId, { ...userData, weekly, monthly }];
    });

    let sorted = [];
    if (category === 'streaks') {
        sorted = processed.sort((a, b) => (b[1].streak || 0) - (a[1].streak || 0));
    } else if (category === 'alltime') {
        sorted = processed.sort((a, b) => (b[1].totalStudyMinutes || 0) - (a[1].totalStudyMinutes || 0));
    } else if (category === 'weekly') {
        sorted = processed.sort((a, b) => (b[1].weekly || 0) - (a[1].weekly || 0));
    } else if (category === 'monthly') {
        sorted = processed.sort((a, b) => (b[1].monthly || 0) - (a[1].monthly || 0));
    }

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
    handleTaskCommand,
    handleReminderCommand
};
