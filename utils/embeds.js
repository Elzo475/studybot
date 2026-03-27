const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMinutes } = require('./storage');

function formatDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function getPeriodMinutes(dailyStudy, days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return Object.entries(dailyStudy).reduce((total, [day, minutes]) => {
        const dayTime = new Date(day).getTime();
        if (!Number.isNaN(dayTime) && dayTime >= cutoff) {
            return total + minutes;
        }
        return total;
    }, 0);
}

function buildStatusEmbed(session) {
    const now = Date.now();
    const elapsed = session.startTime ? Math.floor((now - session.startTime) / 60000) : 0;
    const remaining = Math.max(session.durationMinutes - elapsed, 0);

    const embed = new EmbedBuilder()
        .setTitle('🎯 Focus Session Status')
        .setColor(0x57f287)
        .setDescription(session.isPrivate ? 'Private premium session' : 'Open session for everyone to join')
        .addFields(
            { name: 'Host', value: `<@${session.hostId}>`, inline: true },
            { name: 'Duration', value: `${session.durationMinutes} minutes`, inline: true },
            { name: 'Started', value: session.startTime ? '<t:' + Math.floor(session.startTime / 1000) + ':R>' : 'Starting soon', inline: true },
            { name: 'Participants', value: `${session.participants.size}`, inline: true },
            { name: 'Elapsed', value: `${elapsed} min`, inline: true },
            { name: 'Remaining', value: `${remaining} min`, inline: true }
        )
        .setTimestamp();

    return embed;
}

function buildSessionActionRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('join_session')
            .setLabel('Join Session')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('leave_session')
            .setLabel('Leave Session')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('confirm_session')
            .setLabel('✅ I completed session')
            .setStyle(ButtonStyle.Success)
    );
}

function buildSessionSummaryEmbed(session, recordedMinutes) {
    return new EmbedBuilder()
        .setTitle('✅ Session Complete')
        .setColor(0x0099ff)
        .setDescription(`The ${session.durationMinutes}-minute focus session has finished.`)
        .addFields(
            { name: 'Host', value: `<@${session.hostId}>`, inline: true },
            { name: 'Participants', value: `${session.participants.size}`, inline: true },
            { name: 'Credited time', value: `${formatMinutes(recordedMinutes)}`, inline: true }
        )
        .setFooter({ text: 'Click the completion button to confirm your session and receive feedback.' })
        .setTimestamp();
}

function buildBasicStatsEmbed(user, userData) {
    return new EmbedBuilder()
        .setTitle(`📊 ${user.username}'s Study Stats`)
        .setColor(0x5865f2)
        .addFields(
            { name: 'Check-ins', value: `${userData.checkins}`, inline: true },
            { name: 'Streak', value: `${userData.streak} days`, inline: true },
            { name: 'Sessions Joined', value: `${userData.sessions}`, inline: true },
            { name: 'Study Time', value: `${formatMinutes(userData.totalStudyMinutes)}`, inline: true }
        )
        .setFooter({ text: 'Upgrade to Premium for advanced session analytics and monthly summaries.' })
        .setTimestamp();
}

function buildPremiumStatsEmbed(user, userData, rank = 0) {
    const weekly = getPeriodMinutes(userData.dailyStudy, 7);
    const monthly = getPeriodMinutes(userData.dailyStudy, 30);
    const average = userData.createdAt ? Math.round(userData.totalStudyMinutes / Math.max(1, Math.ceil((Date.now() - userData.createdAt) / (1000 * 60 * 60 * 24)))) : 0;

    return new EmbedBuilder()
        .setTitle(`🌟 Premium Stats for ${user.username}`)
        .setColor(0xffc107)
        .addFields(
            { name: 'Total Study Time', value: `${formatMinutes(userData.totalStudyMinutes)}`, inline: true },
            { name: 'Session Count', value: `${userData.sessions}`, inline: true },
            { name: 'Check-ins', value: `${userData.checkins}`, inline: true },
            { name: 'Current Streak', value: `${userData.streak} days`, inline: true },
            { name: 'Weekly Total', value: `${formatMinutes(weekly)}`, inline: true },
            { name: 'Monthly Total', value: `${formatMinutes(monthly)}`, inline: true },
            { name: 'Average / day', value: `${formatMinutes(average)}`, inline: true },
            { name: 'Rank', value: rank > 0 ? `#${rank}` : '—', inline: true }
        )
        .setFooter({ text: 'Premium unlocks private sessions, advanced reminders, and auto role rewards.' })
        .setTimestamp();
}

function buildLeaderboardEmbed(sorted, isPremium) {
    const embed = new EmbedBuilder()
        .setTitle('🏆 StudyBot Leaderboard')
        .setColor(0xea580c)
        .setDescription(isPremium ? 'Premium leaderboard: streak, sessions, study time' : 'Free leaderboard: top streaks only');

    const streakLines = sorted.slice(0, 5).map((item, index) => {
        const userId = item[0];
        const userData = item[1];
        return `**${index + 1}.** <@${userId}> — ${userData.streak || 0} days`;
    });

    embed.addFields({ name: 'Top Streaks', value: streakLines.length ? streakLines.join('\n') : 'No data yet' });

    if (isPremium) {
        const studyLines = sorted
            .sort((a, b) => (b[1].totalStudyMinutes || 0) - (a[1].totalStudyMinutes || 0))
            .slice(0, 5)
            .map((item, index) => {
                const userId = item[0];
                const userData = item[1];
                return `**${index + 1}.** <@${userId}> — ${formatMinutes(userData.totalStudyMinutes)}`;
            });

        embed.addFields({ name: 'Top Study Time', value: studyLines.length ? studyLines.join('\n') : 'No data yet' });
    }

    return embed;
}

function buildPremiumRequiredEmbed() {
    return new EmbedBuilder()
        .setTitle('🔒 Premium Feature')
        .setDescription('This command is reserved for Premium members. Upgrade to unlock private sessions, goals, advanced stats, and role rewards.')
        .setColor(0xff3864)
        .setFooter({ text: 'Contact an admin to add the Premium role.' })
        .setTimestamp();
}

function buildErrorEmbed(message) {
    return new EmbedBuilder()
        .setDescription(`❌ ${message}`)
        .setColor(0xed4245)
        .setTimestamp();
}

function buildInfoEmbed(title, message) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(message)
        .setColor(0x57f287)
        .setTimestamp();
}

module.exports = {
    buildStatusEmbed,
    buildSessionActionRow,
    buildSessionSummaryEmbed,
    buildBasicStatsEmbed,
    buildPremiumStatsEmbed,
    buildLeaderboardEmbed,
    buildPremiumRequiredEmbed,
    buildErrorEmbed,
    buildInfoEmbed,
    formatDayKey,
    getPeriodMinutes
};
