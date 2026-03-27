const { EmbedBuilder, ChannelType } = require('discord.js');
const storage = require('../utils/storage');
const session = require('../utils/session');
const cooldowns = require('../utils/cooldowns');
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

async function awardStreakReward(member, userData, message) {
    if (!member) return;
    const streak = userData.streak;
    const roleName = STREAK_ROLES[streak];

    if (!roleName) return;
    const badgeText = `🎉 You reached a ${streak}-day streak and earned the **${roleName}** reward!`;

    if (isPremium(member)) {
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

    return message.reply({ embeds: [embeds.buildInfoEmbed('Streak Milestone', `${badgeText} Upgrade to Premium to get the server role automatically.`)] });
}

async function handleGoalCommand(message, args) {
    if (!isPremium(message.member)) {
        return message.reply({ embeds: [embeds.buildPremiumRequiredEmbed()] });
    }

    const goalText = args.join(' ').trim();
    if (!goalText) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a goal after `!goal`.')] });
    }

    storage.setGoal(message.author.id, goalText);
    return message.reply({ embeds: [embeds.buildInfoEmbed('Goal Set', `🎯 Your goal has been saved:
${goalText}`)] });
}

async function handleDoneCommand(message) {
    if (!isPremium(message.member)) {
        return message.reply({ embeds: [embeds.buildPremiumRequiredEmbed()] });
    }

    const goal = storage.getGoal(message.author.id);
    if (!goal) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You currently have no active premium goal.')] });
    }

    storage.clearGoal(message.author.id);
    return message.reply({ embeds: [embeds.buildInfoEmbed('Goal Completed', '🔥 Nicely done! Your premium goal has been marked complete.')] });
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

    const streakReply = `✅ Check-in complete!
📈 Total check-ins: ${userData.checkins}
🔥 Current streak: ${userData.streak} days`;
    await message.reply({ embeds: [embeds.buildInfoEmbed('Daily Check-in', streakReply)] });

    if (STREAK_ROLES[userData.streak]) {
        await awardStreakReward(message.member, userData, message);
    }
}

async function handleStartSessionCommand(message, args, client) {
    if (!isPremium(message.member)) {
        return message.reply({ embeds: [embeds.buildPremiumRequiredEmbed()] });
    }

    if (session.isSessionActive()) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('A focus session is already active. Please wait for it to finish or ask the host to end it.')] });
    }

    const durationArg = args.find(arg => !isNaN(parseInt(arg, 10)));
    const privateFlag = args.some(arg => arg.toLowerCase() === 'private');
    const duration = durationArg ? Math.min(Math.max(parseInt(durationArg, 10), 10), 180) : 50;

    const active = await session.startSession({
        client,
        channel: message.channel,
        hostId: message.author.id,
        durationMinutes: duration,
        isPrivate: privateFlag
    }).catch(error => {
        console.error('Session start failure:', error);
        return null;
    });

    if (!active) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Unable to start the session. Try again later.')] });
    }

    return message.reply({ embeds: [embeds.buildInfoEmbed('Session Enqueued', `Your ${duration}-minute focus session will begin in 1 minute.${privateFlag ? ' Only premium members can join this private session.' : ''}`)] });
}

async function handleJoinCommand(message) {
    const active = session.getActiveSession();
    if (!active) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('No active focus session right now.')] });
    }

    if (active.isPrivate && !isPremium(message.member)) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('This is a private premium session. Upgrade to Premium to join private rooms.')] });
    }

    const joined = session.joinSession(message.author.id);
    if (!joined) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Unable to join the session.')] });
    }

    return message.reply({ embeds: [embeds.buildInfoEmbed('Session Joined', '✅ You joined the focus session. Stay tuned for the completion summary.')] });
}

async function handleStatsCommand(message) {
    const userId = message.author.id;
    const userData = storage.getUserData(userId);

    if (isPremium(message.member)) {
        const allUsers = Object.entries(storage.data).sort((a, b) => (b[1].totalStudyMinutes || 0) - (a[1].totalStudyMinutes || 0));
        const rank = allUsers.findIndex(entry => entry[0] === userId) + 1;
        return message.reply({ embeds: [embeds.buildPremiumStatsEmbed(message.author, userData, rank)] });
    }

    return message.reply({ embeds: [embeds.buildBasicStatsEmbed(message.author, userData)] });
}

async function handleLeaderboardCommand(message) {
    const allUsers = Object.entries(storage.data);
    const sortedByStreak = allUsers.sort((a, b) => (b[1].streak || 0) - (a[1].streak || 0));
    return message.reply({ embeds: [embeds.buildLeaderboardEmbed(sortedByStreak, isPremium(message.member))] });
}

async function handleCreateVCCommand(message) {
    if (!isPremium(message.member)) {
        return message.reply({ embeds: [embeds.buildPremiumRequiredEmbed()] });
    }

    const userData = storage.getUserData(message.author.id);
    if (userData.privateVcId) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You already have a private voice channel.') ]});
    }

    try {
        const channel = await message.guild.channels.create({
            name: `${message.author.username}'s Study Room`,
            type: ChannelType.GuildVoice,
            permissionOverwrites: [
                {
                    id: message.guild.roles.everyone.id,
                    deny: ['Connect']
                },
                {
                    id: message.author.id,
                    allow: ['Connect', 'ManageChannels']
                }
            ]
        });

        userData.privateVcId = channel.id;
        await storage.saveData();

        return message.reply({ embeds: [embeds.buildInfoEmbed('Private VC Created', `🎧 Your private voice channel is ready: ${channel.name}`)] });
    } catch (error) {
        console.error('Create VC failed:', error);
        return message.reply({ embeds: [embeds.buildErrorEmbed('Failed to create your private voice channel.')] });
    }
}

async function handleDeleteVCCommand(message) {
    const userData = storage.getUserData(message.author.id);
    if (!userData.privateVcId) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You do not have a private voice channel.') ]});
    }

    const channel = message.guild.channels.cache.get(userData.privateVcId);
    if (channel) {
        await channel.delete().catch(() => null);
    }

    userData.privateVcId = null;
    await storage.saveData();
    return message.reply({ embeds: [embeds.buildInfoEmbed('Private VC Removed', '🗑️ Your private channel has been removed.')] });
}

async function handleRenameVCCommand(message, args) {
    const newName = args.join(' ').trim();
    if (!newName) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('Please provide a new name after `!renamevc`.')] });
    }

    const userData = storage.getUserData(message.author.id);
    if (!userData.privateVcId) {
        return message.reply({ embeds: [embeds.buildErrorEmbed('You do not have a private voice channel.') ]});
    }

    const channel = message.guild.channels.cache.get(userData.privateVcId);
    if (!channel) {
        userData.privateVcId = null;
        await storage.saveData();
        return message.reply({ embeds: [embeds.buildErrorEmbed('Your saved voice channel could not be found.')] });
    }

    await channel.setName(newName).catch(() => null);
    return message.reply({ embeds: [embeds.buildInfoEmbed('VC Renamed', `✏️ Your channel has been renamed to **${newName}**.`)] });
}

module.exports = {
    isPremium,
    handleGoalCommand,
    handleDoneCommand,
    handleCheckinCommand,
    handleStartSessionCommand,
    handleJoinCommand,
    handleStatsCommand,
    handleLeaderboardCommand,
    handleCreateVCCommand,
    handleDeleteVCCommand,
    handleRenameVCCommand,
    awardStreakReward
};
