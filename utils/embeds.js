const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatMinutes } = require('./storage');

function formatDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function formatTimestamp(timestamp) {
    if (!timestamp) return 'Not started';
    return `<t:${Math.floor(timestamp / 1000)}:R>`;
}

function getPeriodMinutes(dailyStudy, days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return Object.entries(dailyStudy || {}).reduce((total, [day, minutes]) => {
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

    return new EmbedBuilder()
        .setTitle(`🎯 Focus Session • ${session.id}`)
        .setColor(0x57f287)
        .setDescription(session.isPrivate ? 'Private session. The host can invite members manually.' : 'Open session. Join with the session ID or buttons.')
        .addFields(
            { name: 'Host', value: `<@${session.hostId}>`, inline: true },
            { name: 'Session ID', value: `${session.id}`, inline: true },
            { name: 'Mode', value: session.isPrivate ? 'Private' : 'Public', inline: true },
            { name: 'Status', value: session.paused ? 'Paused' : session.started ? 'Active' : 'Preparing', inline: true },
            { name: 'Voice Channel', value: session.voiceChannelId ? `<#${session.voiceChannelId}>` : 'Not assigned', inline: true },
            { name: 'Text Channel', value: session.textChannelId ? `<#${session.textChannelId}>` : 'Not assigned', inline: true },
            { name: 'Participants', value: `${session.participants.size}`, inline: true },
            { name: 'Duration', value: `${session.durationMinutes} minutes`, inline: true },
            { name: 'Phase', value: session.currentPhase ? `${session.currentPhase} ${session.currentPomodoroIndex !== undefined ? `(${session.currentPomodoroIndex + 1}/${(session.pomodoroSets || []).length || 1})` : ''}` : 'Standard', inline: true },
            { name: 'Started', value: formatTimestamp(session.startTime), inline: true },
            { name: 'Remaining', value: session.started ? `${remaining} min` : 'Starting soon', inline: true }
        )
        .setTimestamp();
}

function buildSessionActionRow(sessionId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`join_session:${sessionId}`)
            .setLabel('Join Session')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`leave_session:${sessionId}`)
            .setLabel('Leave Session')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`pause_session:${sessionId}`)
            .setLabel('Pause Session')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`resume_session:${sessionId}`)
            .setLabel('Resume Session')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`cancel_session:${sessionId}`)
            .setLabel('Cancel Session')
            .setStyle(ButtonStyle.Danger)
    );
}

function buildSessionSummaryEmbed(session, recordedMinutes) {
    return new EmbedBuilder()
        .setTitle(`✅ Session Complete • ${session.id}`)
        .setColor(0x0099ff)
        .setDescription(`Your ${session.durationMinutes}-minute focus session has finished.`)
        .addFields(
            { name: 'Host', value: `<@${session.hostId}>`, inline: true },
            { name: 'Participants', value: `${session.participants.size}`, inline: true },
            { name: 'Credited Time', value: `${formatMinutes(recordedMinutes)}`, inline: true }
        )
        .setFooter({ text: 'Great work! Your study time has been recorded.' })
        .setTimestamp();
}

function buildStatsEmbed(user, userData, rank = 0) {
    const weekly = getPeriodMinutes(userData.dailyStudy, 7);
    const monthly = getPeriodMinutes(userData.dailyStudy, 30);
    const average = userData.createdAt ? Math.round(userData.totalStudyMinutes / Math.max(1, Math.ceil((Date.now() - userData.createdAt) / (1000 * 60 * 60 * 24)))) : 0;

    const embed = new EmbedBuilder()
        .setTitle(`📊 ${user.username}'s Study Stats`)
        .setColor(0x5865f2)
        .addFields(
            { name: 'Total Study Time', value: `${formatMinutes(userData.totalStudyMinutes)}`, inline: true },
            { name: 'Sessions Completed', value: `${userData.sessions}`, inline: true },
            { name: 'Check-ins', value: `${userData.checkins}`, inline: true },
            { name: 'Current Streak', value: `${userData.streak} days`, inline: true },
            { name: 'Weekly Total', value: `${formatMinutes(weekly)}`, inline: true },
            { name: 'Monthly Total', value: `${formatMinutes(monthly)}`, inline: true },
            { name: 'Average / day', value: `${formatMinutes(average)}`, inline: true },
            { name: 'Leaderboard Rank', value: rank > 0 ? `#${rank}` : 'Unranked', inline: true }
        )
        .setTimestamp();

    return embed;
}

function buildLeaderboardEmbed(category, sortedEntries, userId) {
    const titleMap = {
        streaks: 'Top Streaks',
        alltime: 'Top Total Study Time',
        weekly: 'Top Weekly Study Time',
        monthly: 'Top Monthly Study Time'
    };

    const descriptionMap = {
        streaks: 'Ranked by current streak.',
        alltime: 'Total study time across all sessions.',
        weekly: 'Study time in the last 7 days.',
        monthly: 'Study time in the last 30 days.'
    };

    const lines = sortedEntries.slice(0, 5).map((item, index) => {
        const userIdEntry = Array.isArray(item) ? item[0] : item.userId;
        const userData = Array.isArray(item) ? item[1] : item.userData;
        const weekly = userData.weekly ?? getPeriodMinutes(userData.dailyStudy, 7);
        const monthly = userData.monthly ?? getPeriodMinutes(userData.dailyStudy, 30);
        let value = '';
        if (category === 'streaks') {
            value = `${userData.streak || 0} days`;
        } else if (category === 'alltime') {
            value = formatMinutes(userData.totalStudyMinutes || 0);
        } else if (category === 'weekly') {
            value = formatMinutes(weekly || 0);
        } else if (category === 'monthly') {
            value = formatMinutes(monthly || 0);
        }
        return `**${index + 1}.** <@${userIdEntry}> — ${value}`;
    });

    const topRank = sortedEntries.findIndex(entry => (Array.isArray(entry) ? entry[0] : entry.userId) === userId) + 1;
    const embed = new EmbedBuilder()
        .setTitle('🏆 StudyBot Leaderboard')
        .setColor(0xea580c)
        .setDescription(descriptionMap[category] || 'Leaderboard results')
        .addFields(
            { name: titleMap[category] || 'Top Results', value: lines.length ? lines.join('\n') : 'No data yet' },
            { name: 'Your Rank', value: topRank > 0 ? `#${topRank}` : 'Not ranked yet', inline: false }
        )
        .setTimestamp();

    return embed;
}

function buildLeaderboardActionRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('leaderboard_streaks')
            .setLabel('Streaks')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('leaderboard_alltime')
            .setLabel('All Time')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('leaderboard_weekly')
            .setLabel('This Week')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('leaderboard_monthly')
            .setLabel('This Month')
            .setStyle(ButtonStyle.Primary)
    );
}

function buildTaskListEmbed(tasks, username) {
    const lines = tasks.length
        ? tasks.map(task => `**${task.id}** • ${task.title}${task.completed ? ' ✅' : ''}${task.dueDate ? ` • due ${task.dueDate}` : ''}${task.description ? `\n_${task.description}_` : ''}`).join('\n\n')
        : 'You have no tasks yet.';

    return new EmbedBuilder()
        .setTitle(`📝 ${username}'s Tasks`)
        .setColor(0x5865f2)
        .setDescription(lines)
        .setTimestamp();
}

function buildReminderListEmbed(reminders, username) {
    const lines = reminders.length
        ? reminders.map(reminder => `**${reminder.id}** • ${reminder.text} • <t:${Math.floor(reminder.dueAt / 1000)}:f>`).join('\n\n')
        : 'You have no reminders set.';

    return new EmbedBuilder()
        .setTitle(`⏰ ${username}'s Reminders`)
        .setColor(0x5865f2)
        .setDescription(lines)
        .setTimestamp();
}

function buildHelpEmbed() {
    return new EmbedBuilder()
        .setTitle('📚 StudyBot Commands')
        .setColor(0x0099ff)
        .setDescription('Everything is free now. Use the commands below to manage sessions, rooms, goals, tasks, reminders, and study stats.')
        .addFields(
            { name: 'Session & Room Management', value: '**!startsession [duration] [private|public] [voiceChannel]** • Start a new focus session\n**!pomodoro list** • Show your saved Pomodoro sets
**!pomodoro add <study> <rest>** • Add a new Pomodoro set
**!pomodoro update <setNumber> <study> <rest>** • Update an existing set
**!pomodoro remove <setNumber>** • Remove a pomodoro set
**!pomodoro clear** • Clear all pomodoro sets
**!pomodoro start [private|public]** • Start a Pomodoro session using configured sets\n**!session status [sessionId]** • Show a session status\n**!session pause [sessionId]** • Pause an active session\n**!session resume [sessionId]** • Resume a paused session\n**!session cancel [sessionId]** • Cancel a session\n**!join <sessionId>** • Join a session by ID\n**!endsession <sessionId>** • End your session\n**!createroom** • Create a private study room\n**!deleteroom** • Delete your private room\n**!renameroom <name>** • Rename your private room\n**!invite <sessionId> @user** • Invite a user to a private session', inline: false },
            { name: 'Goals & Tasks', value: '**!goal <goal> /by YYYY-MM-DD /desc <description>** • Set a goal\n**!done** • Mark a goal complete\n**!task add <task> /by YYYY-MM-DD /desc <description>** • Add a task\n**!task list** • List your tasks\n**!task done <id>** • Complete a task\n**!task remove <id>** • Remove a task', inline: false },
            { name: 'Reminders', value: '**!reminder add <duration|date> <message>** • Set a reminder\n**!reminder list** • List reminders\n**!reminder remove <id>** • Remove a reminder', inline: false },
            { name: 'Stats & Leaderboard', value: '**!checkin** • Daily check-in\n**!stats** • Show your progress\n**!leaderboard** • View the leaderboard categories', inline: false }
        )
        .setFooter({ text: 'Tip: use session IDs and room invites to connect with other students.' })
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

function buildPremiumRequiredEmbed() {
    return new EmbedBuilder()
        .setTitle('🔒 Premium Feature')
        .setDescription('This command is reserved for Premium members. Upgrade to unlock private sessions, goals, advanced stats, and role rewards.')
        .setColor(0xff3864)
        .setFooter({ text: 'Contact an admin to add the Premium role.' })
        .setTimestamp();
}

module.exports = {
    buildStatusEmbed,
    buildSessionActionRow,
    buildSessionSummaryEmbed,
    buildStatsEmbed,
    buildLeaderboardEmbed,
    buildLeaderboardActionRow,
    buildTaskListEmbed,
    buildReminderListEmbed,
    buildHelpEmbed,
    buildPremiumRequiredEmbed,
    buildErrorEmbed,
    buildInfoEmbed,
    formatDayKey,
    getPeriodMinutes
};
