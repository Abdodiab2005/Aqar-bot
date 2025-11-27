# Aqar Bot - Sakani Land Availability Monitor

A robust Node.js Telegram bot that monitors the Sakani API for real-time land availability updates and sends instant notifications when new lands are listed or restocked.

## Features

- **Real-time Monitoring**: Polls the Sakani API every 5 minutes (configurable)
- **Smart Notifications**: Only notifies on:
  - New land listings
  - Previously sold-out lands that become available again
- **Rich Messages**: Formatted Telegram messages with:
  - Project name and details
  - Available units count
  - Starting price
  - Google Maps location link
  - Direct link to reservation page
- **Reliable Storage**: SQLite database for tracking project states
- **Error Handling**: Comprehensive error handling with admin notifications
- **Clean Architecture**: Modular design following Clean Code principles

## Prerequisites

- Node.js (v18 or higher)
- A Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Your Telegram Chat ID

## Installation

1. **Clone or download this repository**

2. **Install dependencies**:
```bash
npm install
```

3. **Configure environment variables**:
```bash
cp .env.example .env
```

Edit `.env` and add your credentials:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
```

### How to Get Your Telegram Bot Token

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Send `/newbot` command
3. Follow the instructions to create your bot
4. Copy the token provided

### How to Get Your Chat ID

1. Search for [@userinfobot](https://t.me/userinfobot) on Telegram
2. Start a chat with the bot
3. It will send you your Chat ID
4. Copy the numeric ID (e.g., `123456789`)

## Usage

### Start the bot:
```bash
npm start
```

### Development mode (with auto-reload):
```bash
npm run dev
```

### Expected Output:
```
🚀 Starting Aqar Bot...
📊 Scrape interval: 5 minutes
✅ Database initialized
🔍 [12/27/2024, 10:30:00 AM] Checking for updates...
📦 Fetched 42 projects from API
✅ Sent 2 new listings and 0 restock notifications
⏰ Scheduled checks every 5 minutes
✅ Bot is running and monitoring for updates
```

## Project Structure

```
Aqar-bot/
├── src/
│   ├── database.js      # SQLite database operations
│   ├── scraper.js       # API fetching and data normalization
│   └── notifier.js      # Telegram notification handling
├── data/
│   └── projects.db      # SQLite database (auto-created)
├── index.js             # Main bot logic and scheduling
├── package.json         # Dependencies and scripts
├── .env                 # Configuration (create from .env.example)
└── README.md           # This file
```

## Configuration Options

Edit `.env` to customize:

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Your Telegram bot token | Required |
| `TELEGRAM_CHAT_ID` | Your Telegram chat ID | Required |
| `SCRAPE_INTERVAL` | Check interval in minutes | 5 |
| `DB_PATH` | SQLite database path | ./data/projects.db |
| `API_URL` | Sakani API endpoint | Pre-configured |

## How It Works

1. **Polling**: Every 5 minutes, the bot fetches land data from the Sakani API
2. **Comparison**: Compares new data with database records
3. **Detection**: Identifies new listings or restocked lands
4. **Notification**: Sends formatted Telegram messages for important updates
5. **Update**: Updates the database with current state

### Notification Logic

The bot sends notifications in two cases:

- **New Listing**: A project ID appears in the API that doesn't exist in the database
- **Restocked**: A project that had 0 units now has available units

## Error Handling

- Network errors are logged and retried on next interval
- Database errors trigger admin notifications
- API errors are caught and reported
- Graceful shutdown on SIGINT/SIGTERM

## Stopping the Bot

Press `Ctrl+C` to stop the bot gracefully. It will:
1. Stop the scheduler
2. Close database connections
3. Exit cleanly

## Troubleshooting

**Bot doesn't start:**
- Check that `.env` file exists and contains valid credentials
- Ensure Node.js v18+ is installed

**No notifications received:**
- Verify your `TELEGRAM_CHAT_ID` is correct
- Check the bot has permission to send messages to you
- Start a chat with your bot on Telegram first

**Database errors:**
- Ensure the `data/` directory is writable
- Delete `data/projects.db` to reset the database

## Contributing

Feel free to submit issues or pull requests to improve the bot.

## License

ISC
