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
    this.scraper = new Scraper(
      process.env.SEARCH_API_URL,
      process.env.COUNTERS_API_URL
    );

    // Parse comma-separated admin IDs
    const adminIds = process.env.TELEGRAM_ADMIN_IDS.split(',').map(id => id.trim());
    this.notifier = new Notifier(
      process.env.TELEGRAM_BOT_TOKEN,
      adminIds
    );

    this.indexerInterval = parseInt(process.env.INDEXER_INTERVAL || '60', 10); // minutes
    this.watcherInterval = parseInt(process.env.WATCHER_INTERVAL || '10', 10);  // seconds

    this.indexerTimerId = null;
    this.watcherTimerId = null;
    this.isIndexing = false;
    this.isWatching = false;
    this.isFirstWatcherRun = true; // Track first run to avoid spam
  }

  /**
   * Validate required environment variables
   */
  validateConfig() {
    const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_IDS', 'SEARCH_API_URL', 'COUNTERS_API_URL'];
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
      console.log('🚀 Starting Aqar Bot with Hybrid Architecture...');
      console.log(`📚 Indexer interval: ${this.indexerInterval} minutes`);
      console.log(`⚡ Watcher interval: ${this.watcherInterval} seconds`);

      await this.database.initialize();
      console.log('✅ Database initialized');

      // Run Indexer immediately to populate database
      console.log('⏳ Running initial Indexer to populate database...');
      await this.runIndexer();
      console.log('✅ Initial indexing complete');

      // Schedule both schedulers
      this.scheduleIndexer();
      this.scheduleWatcher();

      console.log('✅ Bot running with hybrid architecture');
    } catch (error) {
      console.error('❌ Failed to initialize bot:', error.message);
      await this.notifier.sendErrorNotification(`Initialization failed: ${error.message}`);
      process.exit(1);
    }
  }

  /**
   * Schedule periodic Indexer runs
   */
  scheduleIndexer() {
    const intervalMs = this.indexerInterval * 60 * 1000; // Convert minutes to ms

    this.indexerTimerId = setInterval(async () => {
      await this.runIndexer();
    }, intervalMs);

    console.log(`📚 Indexer scheduled: every ${this.indexerInterval} minutes`);
  }

  /**
   * Schedule periodic Watcher runs
   */
  scheduleWatcher() {
    const intervalMs = this.watcherInterval * 1000; // Convert seconds to ms

    this.watcherTimerId = setInterval(async () => {
      await this.runWatcher();
    }, intervalMs);

    console.log(`⚡ Watcher scheduled: every ${this.watcherInterval} seconds`);
  }

  /**
   * Indexer: Fetch and update project metadata from Search API
   * Runs every INDEXER_INTERVAL minutes
   */
  async runIndexer() {
    if (this.isIndexing) {
      console.log('⏭️  Skipping Indexer - previous run still in progress');
      return;
    }

    this.isIndexing = true;
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' });

    try {
      console.log(`\n📚 [${timestamp}] Indexer: Fetching project metadata...`);

      const projects = await this.scraper.fetchSearchAPI();
      console.log(`📦 Indexer: Fetched ${projects.length} projects`);

      for (const project of projects) {
        await this.database.upsertProjectMetadata(project);
      }

      console.log(`✅ Indexer: Updated metadata for ${projects.length} projects`);
    } catch (error) {
      console.error('❌ Indexer error:', error.message);
      await this.notifier.sendErrorNotification(`Indexer failed: ${error.message}`);
    } finally {
      this.isIndexing = false;
    }
  }

  /**
   * Watcher: Monitor unit count changes from Counters API
   * Runs every WATCHER_INTERVAL seconds
   */
  async runWatcher() {
    if (this.isWatching) {
      console.log('⏭️  Skipping Watcher - previous run still in progress');
      return;
    }

    this.isWatching = true;

    try {
      const counters = await this.scraper.fetchCountersAPI();

      let notificationCount = 0;

      // On first run, just initialize counts without sending notifications
      if (this.isFirstWatcherRun) {
        console.log('⏳ First Watcher run - initializing unit counts without notifications...');
        for (const {resource_id, count} of counters) {
          await this.database.updateUnitCount(resource_id, count);
        }
        console.log(`✅ Initialized unit counts for ${counters.length} projects`);
        this.isFirstWatcherRun = false;
        this.isWatching = false;
        return;
      }

      for (const {resource_id, count} of counters) {
        const previousCount = await this.database.getUnitCount(resource_id);

        // Trigger condition: (previousCount === 0 OR previousCount === null) AND currentCount > 0
        if ((previousCount === null || previousCount === 0) && count > 0) {
          const project = await this.database.getProject(resource_id);

          if (project) {
            // Full project details available
            await this.notifier.sendNotification(project, 'restocked');
            console.log(`📤 Watcher: Notification sent for ${project.project_name} (${count} units)`);
          } else {
            // Unknown project - send fallback
            await this.notifier.sendUnknownProjectNotification(resource_id, count);
            await this.database.ensureProjectExists(resource_id);
            console.log(`📤 Watcher: Fallback notification for unknown project ${resource_id}`);
          }

          notificationCount++;
        }

        // Always update the count
        await this.database.updateUnitCount(resource_id, count);
      }

      if (notificationCount > 0) {
        console.log(`⚡ Watcher: Sent ${notificationCount} notifications`);
      }
    } catch (error) {
      console.error('❌ Watcher error:', error.message);
      // Don't spam admin on every Watcher error (runs every 10 seconds)
      // Only log to console unless it's critical
    } finally {
      this.isWatching = false;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('\n🛑 Shutting down bot...');

    if (this.indexerTimerId) {
      clearInterval(this.indexerTimerId);
    }

    if (this.watcherTimerId) {
      clearInterval(this.watcherTimerId);
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
