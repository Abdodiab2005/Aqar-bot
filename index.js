import dotenv from 'dotenv';
import Database from './src/database.js';
import Scraper from './src/scraper.js';
import Notifier from './src/notifier.js';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Ensure logs directory exists
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Main Bot Application
 */
class AqarBot {
  constructor() {
    this.validateConfig();

    this.database = new Database(process.env.DB_PATH || './data/projects.db');
    this.scraper = new Scraper(
      process.env.SEARCH_API_URL || '',  // Optional, not used in Verify-Before-Alert mode
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
    const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_IDS', 'COUNTERS_API_URL'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}\n` +
        'Please check your .env file.'
      );
    }
  }

  /**
   * Save JSON data to log file
   * @param {string} filename - Log filename
   * @param {object} data - Data to save
   */
  saveJsonLog(filename, data) {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filepath = path.join(logsDir, `${timestamp}_${filename}`);
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`📝 Saved log: ${filepath}`);
    } catch (error) {
      console.error(`❌ Failed to save log ${filename}:`, error.message);
    }
  }

  /**
   * Initialize the bot
   */
  async initialize() {
    try {
      console.log('🚀 Starting Aqar Bot with Verify-Before-Alert Strategy...');
      console.log(`⚡ Watcher interval: ${this.watcherInterval} seconds`);
      console.log(`🔍 Validation: Each trigger verified with mainIntermediaryApi`);

      await this.database.initialize();
      console.log('✅ Database initialized');

      // Schedule Watcher only (validation happens on-demand)
      this.scheduleWatcher();

      console.log('✅ Bot running and monitoring for availability changes');
    } catch (error) {
      console.error('❌ Failed to initialize bot:', error.message);
      await this.notifier.sendErrorNotification(`Initialization failed: ${error.message}`);
      process.exit(1);
    }
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
   * Watcher: Monitor unit count changes from Counters API
   * Runs every WATCHER_INTERVAL seconds
   */
  async runWatcher() {
    if (this.isWatching) {
      console.log('⏭️  Skipping Watcher - previous run still in progress');
      return;
    }

    this.isWatching = true;
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' });

    try {
      const counters = await this.scraper.fetchCountersAPI();

      // Save raw response to log file
      this.saveJsonLog('watcher_response.json', {
        timestamp,
        totalProjects: counters.length,
        counters
      });

      let notificationCount = 0;
      const notifications = []; // Track what we're notifying

      // On first run, just initialize counts without sending notifications
      if (this.isFirstWatcherRun) {
        console.log('⏳ First Watcher run - initializing unit counts without notifications...');
        console.log(`📊 Total counters received: ${counters.length}`);

        // Log sample counters
        counters.slice(0, 5).forEach(c => {
          console.log(`  - Resource ID: ${c.resource_id}, Count: ${c.count}`);
        });

        for (const {resource_id, count} of counters) {
          await this.database.updateUnitCount(resource_id, count);
        }
        console.log(`✅ Initialized unit counts for ${counters.length} projects`);
        this.isFirstWatcherRun = false;
        this.isWatching = false;
        return;
      }

      console.log(`\n⚡ [${timestamp}] Watcher: Processing ${counters.length} projects...`);

      for (const {resource_id, count} of counters) {
        const previousCount = await this.database.getUnitCount(resource_id);

        // Trigger condition: (previousCount === 0 OR previousCount === null) AND currentCount > 0
        if ((previousCount === null || previousCount === 0) && count > 0) {
          console.log(`\n🚨 Detected availability change for project ${resource_id}: ${previousCount || 0} → ${count}`);

          // CRITICAL: Verify-Before-Alert - Validate with project-specific API
          console.log(`🔍 Step 1: Validating project ${resource_id} with mainIntermediaryApi...`);
          const validatedProject = await this.scraper.validateProject(resource_id);

          const notificationData = {
            resource_id,
            count,
            previousCount,
            validationPassed: !!validatedProject
          };

          if (validatedProject) {
            // Validation passed - send notification
            notificationData.project_name = validatedProject.project_name;
            notificationData.price = validatedProject.min_non_bene_price;
            notificationData.location = {
              lat: validatedProject.location_lat,
              lon: validatedProject.location_lon,
              city: validatedProject.city,
              region: validatedProject.region
            };
            notificationData.bookable = validatedProject.bookable;

            console.log(`\n📤 Step 2: Sending notification for project ${resource_id}:`);
            console.log(`   Name: ${validatedProject.project_name}`);
            console.log(`   Location: ${validatedProject.city} - ${validatedProject.region}`);
            console.log(`   Price: ${validatedProject.min_non_bene_price} SAR`);
            console.log(`   Units: ${validatedProject.available_units_count}`);
            console.log(`   Bookable: ${validatedProject.bookable}`);
            console.log(`   Developer: ${validatedProject.developer_name || 'N/A'}`);

            // Save validated project to database
            await this.database.upsertProjectMetadata(validatedProject);

            // Send notification
            await this.notifier.sendNotification(validatedProject, 'restocked');
            console.log(`✅ Notification sent successfully`);

            notificationCount++;
          } else {
            // Validation failed - this is a FALSE POSITIVE, ignore it
            console.log(`❌ Step 2: Validation failed for ${resource_id} - Not bookable or no units available`);
            console.log(`   Action: Ignoring false positive (Counter showed ${count} but validation failed)`);
            notificationData.reason = 'false_positive';
          }

          notifications.push(notificationData);
        }

        // Always update the count
        await this.database.updateUnitCount(resource_id, count);
      }

      if (notificationCount > 0) {
        console.log(`\n⚡ Watcher: Sent ${notificationCount} notifications`);

        // Save notification details to log
        this.saveJsonLog('watcher_notifications.json', {
          timestamp,
          totalNotifications: notificationCount,
          notifications
        });
      }
    } catch (error) {
      console.error('❌ Watcher error:', error.message);
      this.saveJsonLog('watcher_error.json', { error: error.message, stack: error.stack });
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
