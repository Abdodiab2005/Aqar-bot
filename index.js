import dotenv from 'dotenv';
import Database from './src/database.js';
import Scraper from './src/scraper.js';
import Notifier from './src/notifier.js';

// Load environment variables
dotenv.config();

/**
 * Main Bot Application
 */
class AqarBot {
  constructor() {
    this.validateConfig();

    this.database = new Database(process.env.DB_PATH || './data/projects.db');
    this.scraper = new Scraper(process.env.API_URL);

    // Parse comma-separated admin IDs
    const adminIds = process.env.TELEGRAM_ADMIN_IDS.split(',').map(id => id.trim());
    this.notifier = new Notifier(
      process.env.TELEGRAM_BOT_TOKEN,
      adminIds
    );

    this.scrapeInterval = parseInt(process.env.SCRAPE_INTERVAL || '30', 10);
    this.intervalId = null;
    this.isProcessing = false;
  }

  /**
   * Validate required environment variables
   */
  validateConfig() {
    const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_IDS', 'API_URL'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please check your .env file.'
      );
    }
  }

  /**
   * Initialize the bot
   */
  async initialize() {
    try {
      console.log('🚀 Starting Aqar Bot...');
      console.log(`📊 Scrape interval: ${this.scrapeInterval} seconds`);

      await this.database.initialize();
      console.log('✅ Database initialized');

      // Run first check immediately
      await this.checkForUpdates();

      // Schedule periodic checks
      this.scheduleChecks();

      console.log('✅ Bot is running and monitoring for updates');
    } catch (error) {
      console.error('❌ Failed to initialize bot:', error.message);
      await this.notifier.sendErrorNotification(`Initialization failed: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Schedule periodic API checks
   */
  scheduleChecks() {
    const intervalMs = this.scrapeInterval * 1000;

    this.intervalId = setInterval(async () => {
      await this.checkForUpdates();
    }, intervalMs);

    console.log(`⏰ Scheduled checks every ${this.scrapeInterval} seconds`);
  }

  /**
   * Main logic: Check for updates and send notifications
   */
  async checkForUpdates() {
    if (this.isProcessing) {
      console.log('⏭️  Skipping check - previous check still in progress');
      return;
    }

    this.isProcessing = true;
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' });

    try {
      console.log(`\n🔍 [${timestamp}] Checking for updates...`);

      const projects = await this.scraper.fetchProjects();
      console.log(`📦 Fetched ${projects.length} projects from API`);

      let newCount = 0;
      let restockedCount = 0;

      for (const project of projects) {
        await this.processProject(project, (reason) => {
          if (reason === 'new_listing') newCount++;
          if (reason === 'restocked') restockedCount++;
        });
      }

      if (newCount > 0 || restockedCount > 0) {
        console.log(`✅ Sent ${newCount} new listings and ${restockedCount} restock notifications`);
      } else {
        console.log('ℹ️  No new updates found');
      }
    } catch (error) {
      console.error('❌ Error during update check:', error.message);
      await this.notifier.sendErrorNotification(`Update check failed: ${error.message}`);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process individual project
   * @param {object} project - Project data from API
   * @param {function} onNotify - Callback when notification is sent
   */
  async processProject(project, onNotify) {
    try {
      const { shouldNotify, reason } = await this.database.shouldNotify(project);

      if (shouldNotify) {
        await this.notifier.sendNotification(project, reason);
        console.log(`📤 Notification sent: ${project.project_name} (${reason})`);

        if (onNotify) {
          onNotify(reason);
        }
      }

      // Update or insert project in database
      const existingProject = await this.database.getProject(project.id);
      if (existingProject) {
        await this.database.updateProject(project);
      } else {
        await this.database.insertProject(project);
      }
    } catch (error) {
      console.error(`❌ Error processing project ${project.id}:`, error.message);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('\n🛑 Shutting down bot...');

    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    await this.database.close();
    console.log('✅ Database connection closed');
    console.log('👋 Goodbye!');

    process.exit(0);
  }
}

// Initialize and run the bot
const bot = new AqarBot();

// Handle graceful shutdown
process.on('SIGINT', () => bot.shutdown());
process.on('SIGTERM', () => bot.shutdown());

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  await bot.notifier.sendErrorNotification(`Uncaught exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  await bot.notifier.sendErrorNotification(`Unhandled rejection: ${reason}`);
});

// Start the bot
bot.initialize().catch(async (error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
