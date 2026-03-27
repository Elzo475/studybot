# StudyBot

A Discord study bot with free and premium features for focus sessions, check-ins, stats, and voice channel support.

## Free User Commands

- `!checkin`
  - Daily check-in to maintain streaks.
  - Free users earn streak badges and basic progress tracking.

- `!join`
  - Join an active focus session.
  - Free users can participate in public sessions.

- `!stats`
  - View your basic study stats.
  - Includes check-ins, sessions joined, streak, and total study time.

- `!leaderboard`
  - See the top streaks leaderboard.
  - Displays ranking with clear embed formatting.

- `!help`
  - Shows available bot commands.

## Premium User Commands

- `!goal <your goal>`
  - Set a premium study goal.
  - Premium users receive smart reminders and goal tracking.

- `!done`
  - Mark your active premium goal as completed.

- `!startsession [duration] [private]`
  - Start a premium focus session.
  - Optional duration in minutes (default 50, minimum 10, maximum 180).
  - Add `private` to create a private premium-only session.

- `!createvc`
  - Create a private voice channel for study sessions.

- `!deletevc`
  - Delete your private channel.

- `!renamevc <name>`
  - Rename your premium private voice channel.

- `!stats`
  - View advanced stats with weekly/monthly totals and rank.

## Notes

- Free users can join public focus sessions, use `!checkin`, view basic stats, and participate in the leaderboard.
- Premium users unlock goals, private/custom sessions, private VC creation, advanced analytics, and automatic streak role rewards.
- The bot uses embeds for cleaner output and reduces spam with button interactions and reminders.

## Running the Bot

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with your bot token and optionally a guild ID:
   ```env
   TOKEN=your-discord-bot-token
   GUILD_ID=your-guild-id
   PORT=3000
   ```

3. Start the bot:
   ```bash
   node index.js
   ```
