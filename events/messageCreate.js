const handlers = require('../commands/handlers');
const embeds = require('../utils/embeds');

module.exports = (client) => {
    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.guild || !message.content.startsWith('!')) return;

        const args = message.content.slice(1).trim().split(/\s+/);
        const command = args.shift().toLowerCase();

        switch (command) {
            case 'goal':
                return handlers.handleGoalCommand(message, args);
            case 'done':
                return handlers.handleDoneCommand(message);
            case 'checkin':
                return handlers.handleCheckinCommand(message);
            case 'startsession':
                return handlers.handleStartSessionCommand(message, args, client);
            case 'pomodoro':
                return handlers.handlePomodoroCommand(message, args, client);
            case 'session':
                return handlers.handleSessionCommand(message, args, client);
            case 'join':
                return handlers.handleJoinCommand(message, args, client);
            case 'status':
                return handlers.handleStatusCommand(message, args);
            case 'endsession':
                return handlers.handleEndSessionCommand(message, args, client);
            case 'invite':
                return handlers.handleInviteCommand(message, args, client);
            case 'stats':
                return handlers.handleStatsCommand(message);
            case 'leaderboard':
                return handlers.handleLeaderboardCommand(message);
            case 'createroom':
            case 'createvc':
                return handlers.handleCreateVCCommand(message);
            case 'deleteroom':
            case 'deletevc':
                return handlers.handleDeleteVCCommand(message);
            case 'renameroom':
            case 'renamevc':
                return handlers.handleRenameVCCommand(message, args);
            case 'task':
                return handlers.handleTaskCommand(message, args);
            case 'reminder':
                return handlers.handleReminderCommand(message, args);
            case 'help':
                return message.reply({ embeds: [embeds.buildHelpEmbed()] });
            default:
                return message.reply({ content: 'Unknown command. Try `!help` for a list of available study bot commands.' });
        }
    });
};
