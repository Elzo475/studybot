const session = require('../utils/session');
const handlers = require('../commands/handlers');

module.exports = (client) => {
    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        const userId = interaction.user.id;
        const customId = interaction.customId;

        if (customId.startsWith('join_session:')) {
            const sessionId = customId.split(':')[1];
            const active = session.getSession(sessionId);
            if (!active) {
                return interaction.reply({ content: '❌ There is no active session with that ID.', ephemeral: true });
            }

            if (active.isPrivate && !active.participants.has(userId)) {
                if (active.pendingRequests.has(userId)) {
                    return interaction.reply({ content: '✅ Your join request is already pending with the host.', ephemeral: true });
                }

                active.pendingRequests.add(userId);
                const host = await interaction.guild.members.fetch(active.hostId).catch(() => null);
                const requestText = `<@${userId}> requested access to private session **${active.id}**.`;

                if (host) {
                    host.send(requestText).catch(() => null);
                }
                const sessionChannel = await client.channels.fetch(active.textChannelId).catch(() => null);
                if (sessionChannel) {
                    sessionChannel.send(requestText).catch(() => null);
                }

                return interaction.reply({ content: '✅ Request sent to the host. They can invite you with `!invite`.', ephemeral: true });
            }

            session.joinSession(userId, sessionId);
            return interaction.reply({ content: `✅ You joined session **${sessionId}**.`, ephemeral: true });
        }

        if (customId.startsWith('leave_session:')) {
            const sessionId = customId.split(':')[1];
            const active = session.getSession(sessionId);
            if (!active) {
                return interaction.reply({ content: '❌ There is no active session to leave.', ephemeral: true });
            }

            session.leaveSession(userId, sessionId);
            return interaction.reply({ content: '⚠️ You left the session.', ephemeral: true });
        }

        if (customId.startsWith('confirm_session:')) {
            const sessionId = customId.split(':')[1];
            const active = session.getSession(sessionId);
            if (!active) {
                return interaction.reply({ content: '✅ The session is already complete or not found.', ephemeral: true });
            }

            const confirmed = session.confirmCompletion(userId, sessionId);
            if (!confirmed) {
                return interaction.reply({ content: '❌ Join the session first before confirming completion.', ephemeral: true });
            }

            return interaction.reply({ content: '✅ Session confirmed! Your progress is noted.', ephemeral: true });
        }

        if (customId.startsWith('pause_session:')) {
            const sessionId = customId.split(':')[1];
            const active = session.getSession(sessionId);
            if (!active) {
                return interaction.reply({ content: '❌ Session not found.', ephemeral: true });
            }
            if (active.hostId !== userId) {
                return interaction.reply({ content: 'Only the host can pause the session.', ephemeral: true });
            }
            const paused = session.pauseSession(sessionId);
            return interaction.reply({ content: paused ? '⏸️ Session paused. Resume when ready.' : '❌ Unable to pause the session.', ephemeral: true });
        }

        if (customId.startsWith('resume_session:')) {
            const sessionId = customId.split(':')[1];
            const active = session.getSession(sessionId);
            if (!active) {
                return interaction.reply({ content: '❌ Session not found.', ephemeral: true });
            }
            if (active.hostId !== userId) {
                return interaction.reply({ content: 'Only the host can resume the session.', ephemeral: true });
            }
            const resumed = await session.resumeSession(client, sessionId);
            return interaction.reply({ content: resumed ? '▶️ Session resumed.' : '❌ Unable to resume the session. It may have expired.', ephemeral: true });
        }

        if (customId.startsWith('cancel_session:')) {
            const sessionId = customId.split(':')[1];
            const active = session.getSession(sessionId);
            if (!active) {
                return interaction.reply({ content: '❌ Session not found.', ephemeral: true });
            }
            if (active.hostId !== userId) {
                return interaction.reply({ content: 'Only the host can cancel the session.', ephemeral: true });
            }
            await session.endSession(client, sessionId);
            return interaction.reply({ content: '🗑️ Session cancelled and cleaned up.', ephemeral: true });
        }

        if (customId.startsWith('leaderboard_')) {
            return handlers.handleLeaderboardInteraction(interaction);
        }
    });
};
