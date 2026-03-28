# StudyBot

A Discord study bot for study sessions, goals, tasks, reminders, stats, and voice channel support.

## What Changed

- All features are free and accessible to everyone.
- Premium gating has been disabled while the bot remains ready for future upgrades.
- New commands support private study rooms, session pause/resume/cancel, pomodoro mode, and leaderboard categories.

## Available Commands

### Session & Voice

- `!startsession [duration] [private|public] [voiceChannel]`
  - Start a new focus session.
  - Default duration is 50 minutes.
  - Use `private` to create or join a private study room.
  - Use `public` to assign a public voice channel.

- `!pomodoro start [private|public] [sets]`
  - Start a pomodoro-style session with optional mode and number of sets.

- `!session status [sessionId]`
  - Show the current status of a session.

- `!session pause [sessionId]`
  - Pause an active session.

- `!session resume [sessionId]`
  - Resume a paused session.

- `!session cancel [sessionId]`
  - Cancel a session before it ends.

- `!join <sessionId>`
  - Join a session by its ID.

- `!endsession <sessionId>`
  - End your session and record study time.

- `!createroom`
  - Create a private category with a voice channel and text channel.

- `!deleteroom`
  - Delete your private study room.

- `!renameroom <name>`
  - Rename your private study room.

- `!invite <sessionId> @user`
  - Invite a user into your private session.

### Goals & Tasks

- `!goal <goal> /by YYYY-MM-DD /desc <description>`
  - Set a study goal with an optional due date and description.

- `!done`
  - Mark your current goal as completed.

- `!task add <task> /by YYYY-MM-DD /desc <description>`
  - Add a daily task with optional due date and description.

- `!task list`
  - List your open tasks.

- `!task done <id>`
  - Mark a task as completed.

- `!task remove <id>`
  - Remove a task.

### Reminders

- `!reminder add <duration|date> <message>`
  - Set a reminder for a duration like `30m` or a date like `2026-04-01T18:00`.

- `!reminder list`
  - List your reminders.

- `!reminder remove <id>`
  - Remove a reminder.

### Stats & Leaderboard

- `!checkin`
  - Daily check-in for streak tracking.

- `!stats`
  - View your study stats, streaks, total study time, and rank.

- `!leaderboard`
  - View leaderboard categories using buttons for streaks, all time, weekly, and monthly.

- `!help`
  - Show this command list.

## Notes

- Private rooms are created in a dedicated category with a linked chat channel.
- Session IDs let people join by ID and request access for private sessions.
- Voice activity is tracked across all voice channels for study time.
- Private rooms are cleaned up automatically after inactivity.

## Running the Bot

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with your bot token and optional guild ID:
   ```env
   TOKEN=your-discord-bot-token
   GUILD_ID=your-guild-id
   PORT=3000
   ```

3. Start the bot:
   ```bash
   node index.js
   ```
