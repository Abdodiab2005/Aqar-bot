# Quick Start Guide

## Setup (5 minutes)

### 1. Get Telegram Bot Token

1. Open Telegram
2. Search for `@BotFather`
3. Send: `/newbot`
4. Choose a name: `My Aqar Monitor`
5. Choose a username: `my_aqar_bot` (must end with 'bot')
6. Copy the token (looks like: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

### 2. Get Your Chat ID

1. Search for `@userinfobot` on Telegram
2. Start the bot
3. Copy your ID (a number like: `987654321`)

### 3. Configure the Bot

```bash
# Run setup script
./setup.sh

# Edit .env file
nano .env
```

Add your credentials:
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=987654321
```

Save and exit (`Ctrl+X`, then `Y`, then `Enter`)

### 4. Start the Bot

```bash
npm start
```

## What to Expect

### First Run
The bot will:
1. Create the database
2. Fetch all current listings
3. Store them in the database
4. Start monitoring every 5 minutes

**Important**: On first run, you'll get notifications for ALL current listings (because they're all "new" to the database). This is normal!

### After First Run
You'll only get notifications when:
- A completely new project is added
- A sold-out project becomes available again

### Sample Notification

```
🆕 New Listing

📋 Project: مشروع ملتقى الوادي - المدينة المنورة
🏗️ Available Units: 15
💰 Starting Price: 62,257 SAR
📍 Location: View on Google Maps

[🔗 View / Reserve Now] (button)
```

## Testing Tips

### Test with a shorter interval
Edit `.env`:
```env
SCRAPE_INTERVAL=1  # Check every 1 minute instead of 5
```

### Reset the database
To get all notifications again (for testing):
```bash
rm -rf data/projects.db
npm start
```

### Check logs
The bot prints detailed logs:
```
🔍 [12/27/2024, 10:30:00 AM] Checking for updates...
📦 Fetched 42 projects from API
📤 Notification sent: مشروع ملتقى الوادي (new_listing)
✅ Sent 3 new listings and 0 restock notifications
```

## Troubleshooting

### "Missing required environment variables"
- Make sure you created `.env` file
- Check that variables are spelled correctly
- No spaces around the `=` sign

### "Failed to send Telegram message"
- Verify your `TELEGRAM_BOT_TOKEN` is correct
- Make sure you started a chat with your bot on Telegram
- Check your `TELEGRAM_CHAT_ID` is correct (just numbers, no quotes)

### "Network Error"
- Check your internet connection
- The Sakani API might be temporarily down
- The bot will retry on the next interval

## Running in Background

### Using PM2 (recommended)
```bash
npm install -g pm2
pm2 start index.js --name aqar-bot
pm2 logs aqar-bot  # View logs
pm2 stop aqar-bot  # Stop bot
pm2 restart aqar-bot  # Restart bot
```

### Using screen
```bash
screen -S aqar-bot
npm start
# Press Ctrl+A then D to detach
# screen -r aqar-bot to reattach
```

### Using nohup
```bash
nohup npm start > bot.log 2>&1 &
tail -f bot.log  # View logs
```

## Next Steps

- Adjust `SCRAPE_INTERVAL` to your preference (in minutes)
- Monitor the bot logs to ensure it's working
- Consider running it on a VPS for 24/7 monitoring

Happy monitoring! 🏡
