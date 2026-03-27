const session = require('../utils/session');
const handlers = require('../commands/handlers');

module.exports = (client) => {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        const userId = interaction.user.id;
        const member = interaction.member;
        const active = session.getActiveSession();

        if (interaction.customId === 'join_session') {
            if (!active) {
                return interaction.reply({ content: '❌ There is no active focus session.', ephemeral: true });
            }

            if (active.isPrivate && !handlers.isPremium(member)) {
                return interaction.reply({ content: '🔒 This private session is reserved for Premium members.', ephemeral: true });
            }

            session.joinSession(userId);
            return interaction.reply({ content: '✅ You joined the session!', ephemeral: true });
        }

        if (interaction.customId === 'leave_session') {
            if (!active) {
                return interaction.reply({ content: '❌ There is no active session to leave.', ephemeral: true });
            }

            session.leaveSession(userId);
            return interaction.reply({ content: '⚠️ You left the session.', ephemeral: true });
        }

        if (interaction.customId === 'confirm_session') {
            if (!active) {
                return interaction.reply({ content: '✅ The session is already complete. Your time has been recorded if you participated.', ephemeral: true });
            }

            const confirmed = session.confirmCompletion(userId);
            if (!confirmed) {
                return interaction.reply({ content: '❌ Join the session first before confirming completion.', ephemeral: true });
            }

            return interaction.reply({ content: '✅ Session confirmed! Your progress is noted.', ephemeral: true });
        }
    });
};
