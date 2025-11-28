import dotenv from "dotenv";
import Database from "./src/database.js";
import Scraper from "./src/scraper.js";
import Notifier from "./src/notifier.js";
import fs from "fs";
import path from "path";

// Load environment variables
dotenv.config();

// Ensure logs directory exists
const logsDir = "./logs";
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Main Bot Application
 */
class AqarBot {
  constructor() {
    this.validateConfig();

    this.database = new Database(process.env.DB_PATH || "./data/projects.db");
    // Use the specific filtered URL provided by the user
    const searchApiUrl =
      "https://sakani.sa/marketplaceApi/search/v3/location?filter%5Bmarketplace_purpose%5D=buy&filter%5Bnhc%5D=false&filter%5Bproduct_types%5D=lands&filter%5Btarget_segment_info%5D=beneficiary&filter%5Bland_type%5D=moh_lands&filter%5Bmode%5D=maps&filter%5Bpurchasing_power%5D=0&filter%5Buse_default_listing%5D=false&sort=-views_count";
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

        // Trigger: 0→N transition
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

          // STEP 2 VERIFICATION: Check Search API data
          const searchData = searchMap.get(resource_id);

          if (!searchData) {
            console.log(
              `⚠️  Step 2: Project ${resource_id} not found in Search API - Proceeding to Validation (Step 3)`
            );
            notificationData.step2_search = "not_found_proceeding";
            // Do not skip, proceed to Step 3
          } else {
            const isBookable =
              searchData.bookable === true || searchData.bookable === 1;
            const searchUnits = searchData.available_units_count || 0;

            console.log(`📋 Step 2: Search API check for ${resource_id}:`);
            console.log(`   bookable: ${isBookable}`);
            console.log(`   available_units_count: ${searchUnits}`);

            // MODIFIED: Proceed to Step 3 even if Search API shows 0 units or is not bookable
            // We rely on Step 3 (Validation) as the source of truth
            console.log(
              `✅ Step 2: Project found in Search API. Proceeding to Validation...`
            );
            notificationData.step2_search = "passed";
          }

          // STEP 3 VALIDATION: Final confirmation with mainIntermediaryApi
          console.log(
            `🔍 Step 3: Final validation with mainIntermediaryApi...`
          );
          const validatedProject = await this.scraper.validateProject(
            resource_id
          );

          if (!validatedProject) {
            console.log(`❌ Step 3: Validation failed for ${resource_id}`);
            notificationData.step3_validation = "failed";
            notifications.push(notificationData);
            await this.database.updateUnitCount(resource_id, count);
            continue;
          }

          console.log(`✅ Step 3: Validation passed`);
          notificationData.step3_validation = "passed";
          notificationData.project_name = validatedProject.project_name;
          notificationData.finalUnits = validatedProject.available_units_count;

          // ALL CHECKS PASSED - SEND NOTIFICATION
          console.log(`\n📤 All checks passed - Sending notification:`);
          console.log(`   Name: ${validatedProject.project_name}`);
          console.log(
            `   Location: ${validatedProject.city} - ${validatedProject.region}`
          );
          console.log(`   Price: ${validatedProject.min_non_bene_price} SAR`);
          console.log(`   Units: ${validatedProject.available_units_count}`);

          await this.database.upsertProjectMetadata(validatedProject);
          await this.notifier.sendNotification(validatedProject, "available");
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
