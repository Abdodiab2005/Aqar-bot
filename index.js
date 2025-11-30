import dotenv from "dotenv";
import Database from "./src/database.js";
import Scraper from "./src/scraper.js";
import Notifier from "./src/notifier.js";

// Load environment variables
dotenv.config();

/**
 * Main Bot Application
 */
class AqarBot {
  constructor() {
    this.validateConfig();

    this.database = new Database(process.env.DB_PATH || "./data/projects.db");
    // Use the specific filtered URL provided by the user
    const searchApiUrl = process.env.SEARCH_API_URL;
    this.scraper = new Scraper(searchApiUrl, process.env.COUNTERS_API_URL);

    // Parse comma-separated admin IDs
    const adminIds = process.env.TELEGRAM_ADMIN_IDS.split(",").map((id) =>
      id.trim()
    );
    this.notifier = new Notifier(process.env.TELEGRAM_BOT_TOKEN, adminIds);

    this.checkInterval = parseInt(process.env.CHECK_INTERVAL || "1", 10); // minutes

    this.checkTimerId = null;
    this.isChecking = false;
    this.isFirstRun = true; // Track first run to avoid spam
  }

  /**
   * Validate required environment variables
   */
  validateConfig() {
    const required = [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_ADMIN_IDS",
      "COUNTERS_API_URL",
      "SEARCH_API_URL",
    ];
    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}\n` +
          "Please check your .env file."
      );
    }
  }

  /**
   * Initialize the bot
   */
  async initialize() {
    try {
      console.log("🚀 Starting Aqar Bot with 3-Step Verification...");
      console.log(`⏱  Check interval: ${this.checkInterval} minute(s)`);
      console.log(`🔍 Verification: Counters → Search → Validation`);

      await this.database.initialize();
      console.log("✅ Database initialized");

      // Schedule checks
      this.scheduleChecks();

      console.log("✅ Bot running and monitoring for availability changes");
    } catch (error) {
      console.error("❌ Failed to initialize bot:", error.message);
      await this.notifier.sendErrorNotification(
        `Initialization failed: ${error.message}`
      );
      process.exit(1);
    }
  }

  /**
   * Schedule periodic checks
   */
  scheduleChecks() {
    const intervalMs = this.checkInterval * 60 * 1000; // Convert minutes to ms

    this.checkTimerId = setInterval(async () => {
      await this.runCheck();
    }, intervalMs);

    console.log(`⏰ Checks scheduled: every ${this.checkInterval} minute(s)`);
  }

  /**
   * Main Check: 3-Step Verification Process
   * Runs every CHECK_INTERVAL minutes
   */
  async runCheck() {
    if (this.isChecking) {
      console.log("⏭️  Skipping check - previous check still in progress");
      return;
    }

    this.isChecking = true;
    const timestamp = new Date().toLocaleString("en-US", {
      timeZone: "Asia/Riyadh",
    });

    try {
      console.log(
        `\n🔍 [${timestamp}] Starting 3-step verification process...`
      );

      // STEP 1: Fetch Counters API (Source A)
      console.log(`📊 Step 1: Fetching counters...`);
      const counters = await this.scraper.fetchCountersAPI();
      console.log(`✅ Received ${counters.length} project counters`);

      // STEP 2: Fetch Search API (Source B - for verification data)
      console.log(`📊 Step 2: Fetching search data...`);
      const searchProjects = await this.scraper.fetchSearchAPI();
      console.log(`✅ Received ${searchProjects.length} search projects`);

      // Create lookup map for search data
      const searchMap = new Map();
      searchProjects.forEach((p) => searchMap.set(p.resource_id, p));

      let notificationCount = 0;
      const notifications = [];

      // On first run, just initialize counts
      if (this.isFirstRun) {
        console.log("⏳ First run - initializing database...");
        for (const { resource_id, count } of counters) {
          await this.database.updateUnitCount(resource_id, count);
        }
        console.log(`✅ Initialized ${counters.length} projects`);
        this.isFirstRun = false;
        this.isChecking = false;
        return;
      }

      console.log(`\n⚡ Processing ${counters.length} projects...`);

      for (const { resource_id, count } of counters) {
        const previousCount = await this.database.getUnitCount(resource_id);

        // Trigger: 0→N transition (Source of Truth: Counters API)
        if ((previousCount === null || previousCount === 0) && count > 0) {
          console.log(
            `\n🚨 Trigger detected for project ${resource_id}: ${
              previousCount || 0
            } → ${count}`
          );

          const notificationData = {
            resource_id,
            counterCount: count,
            previousCount,
            step1_counters: "passed",
            step2_search: null,
            step3_validation: null,
          };

          // STEP 2: Enrichment & Type Validation (Search API)
          const searchData = searchMap.get(resource_id);

          if (!searchData) {
            console.log(
              `⚠️  Step 2: Project ${resource_id} not found in Search API - Skipping`
            );
            notificationData.step2_search = "not_found";
            // Update counter to avoid re-triggering if it stays > 0
            await this.database.updateUnitCount(resource_id, count);
            continue;
          }

          // Strict Type Validation
          if (searchData.project_type !== "lands_moh_land") {
            console.log(
              `⚠️  Step 2: Project ${resource_id} is type '${searchData.project_type}' (not lands_moh_land) - Skipping`
            );
            notificationData.step2_search = "invalid_type";
            await this.database.updateUnitCount(resource_id, count);
            continue;
          }

          console.log(
            `✅ Step 2: Validated 'lands_moh_land' for ${resource_id}`
          );
          notificationData.step2_search = "passed";

          // STEP 3: Soft Validation (Validation API)
          // We try to get the most up-to-date details, but fallback to Search API if it fails
          console.log(`🔍 Step 3: Soft validation with mainIntermediaryApi...`);

          let finalProjectData = null;
          const validatedProject = await this.scraper.validateProject(
            resource_id
          );

          if (validatedProject) {
            console.log(`✅ Step 3: Validation passed (Using fresh data)`);
            notificationData.step3_validation = "passed";
            finalProjectData = validatedProject;
          } else {
            console.log(
              `⚠️  Step 3: Validation failed/timeout - FALLBACK to Search API data`
            );
            notificationData.step3_validation = "fallback";

            // Construct project object from Search API data (Step 2)
            // We use the 'count' from Counters API (Step 1) as it's the source of truth for availability
            finalProjectData = {
              ...searchData,
              available_units_count: count, // Override with live counter
            };
          }

          notificationData.project_name = finalProjectData.project_name;
          notificationData.finalUnits = finalProjectData.available_units_count;

          // ALL CHECKS PASSED - SEND NOTIFICATION
          console.log(`\n📤 Sending notification for ${resource_id}:`);
          console.log(`   Name: ${finalProjectData.project_name}`);
          console.log(
            `   Location: ${finalProjectData.city} - ${finalProjectData.region}`
          );
          console.log(`   Units: ${finalProjectData.available_units_count}`);
          console.log(
            `   Source: ${
              notificationData.step3_validation === "passed"
                ? "Validation API"
                : "Search API (Fallback)"
            }`
          );

          await this.database.upsertProjectMetadata(finalProjectData);
          await this.notifier.sendNotification(finalProjectData, "available");
          console.log(`✅ Notification sent successfully`);

          notificationCount++;
          notifications.push(notificationData);
        }

        // Always update counter
        await this.database.updateUnitCount(resource_id, count);
      }

      if (notificationCount > 0) {
        console.log(
          `\n🎯 Check complete: Sent ${notificationCount} verified notifications`
        );
      } else {
        console.log(`\nℹ️  Check complete: No new opportunities found`);
      }
    } catch (error) {
      console.error("❌ Check error:", error.message);

      await this.notifier.sendErrorNotification(
        `Check failed: ${error.message}`
      );
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log("\n🛑 Shutting down bot...");

    if (this.checkTimerId) {
      clearInterval(this.checkTimerId);
    }

    await this.database.close();
    console.log("✅ Database connection closed");
    console.log("👋 Goodbye!");

    process.exit(0);
  }
}

// Initialize and run the bot
const bot = new AqarBot();

// Handle graceful shutdown
process.on("SIGINT", () => bot.shutdown());
process.on("SIGTERM", () => bot.shutdown());

// Handle uncaught errors
process.on("uncaughtException", async (error) => {
  console.error("💥 Uncaught Exception:", error);
  await bot.notifier.sendErrorNotification(
    `Uncaught exception: ${error.message}`
  );
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
  await bot.notifier.sendErrorNotification(`Unhandled rejection: ${reason}`);
});

// Start the bot
bot.initialize().catch(async (error) => {
  console.error("💥 Fatal error:", error);
  process.exit(1);
});
