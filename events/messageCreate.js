const handlers = require('../commands/handlers');
const session = require('../utils/session');

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
            case 'join':
                return handlers.handleJoinCommand(message);
            case 'stats':
                return handlers.handleStatsCommand(message);
            case 'leaderboard':
                return handlers.handleLeaderboardCommand(message);
            case 'createvc':
                return handlers.handleCreateVCCommand(message);
            case 'deletevc':
                return handlers.handleDeleteVCCommand(message);
            case 'renamevc':
                return handlers.handleRenameVCCommand(message, args);
            case 'help':
                return message.reply({ content: 'Use commands: !checkin, !join, !stats, !leaderboard, !goal (Premium), !startsession (Premium), !createvc (Premium), !deletevc (Premium), !renamevc (Premium).' });
            default:
                return message.reply({ content: 'Unknown command. Try `!help` for a list of available study bot commands.' });
        }
    });
};
