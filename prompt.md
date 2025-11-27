**Role:** Act as a Senior Backend Developer & Systems Architect specialized in Node.js, Web Scraping, and Automation.

**Objective:**
Build a **High-Precision, Hybrid Architecture Telegram Bot** to monitor real estate availability on "Sakani".
You must solve the latency problem by using two different data sources:

1.  **The Indexer (Catalog):** Fetches detailed project info (Name, Price, Location) from the "Search API".
2.  **The Watcher (Real-time):** Fetches the live unit counts from the "Counters API" (extremely fast & accurate).

**Tech Stack:**

- Node.js (Async/Await)
- `axios` (HTTP Requests)
- `sqlite3` (Local Database for caching and state diffing)
- `node-telegram-bot-api` (For notifications)
- `dotenv` (Configuration)

---

### 1\. Data Source Analysis (CRITICAL)

**Source A: The Counters API (Live & Fast)**

- **Use for:** Real-time monitoring of `available_units`.
- **Structure:** A flat JSON object where Key = `resource_id` and Value = `count`.
- **Snippet:**
  ```json
  {
    "buy_units_count": {
      "1004": 11, // <--- This ID (1004) maps to "resource_id" in Source B
      "1002": 68,
      "506": 0
    }
  }
  ```

**Source B: The Search API (Rich Details but Slower)**

- **Use for:** Fetching project names, prices, and coordinates.
- **Structure:** JSON API with a `data` array.
- **Snippet:**
  ```json
  {
    "data": [
      {
        "id": "project_1004",
        "attributes": {
          "resource_id": 1004, // <--- MATCHES Source A Key
          "project_name": "مخطط ولي العهد (المروج)",
          "min_non_bene_price": 177353,
          "banner_url": "https://...",
          "location": { "lat": 21.29, "lon": 39.73 }
        }
      }
    ]
  }
  ```

---

### 2\. The Logic (Hybrid Engine)

Implement the following workflow strictly:

**Phase 1: Database Initialization (`initDB`)**

- Create a table `projects` with columns: `id` (Primary Key, e.g., 1004), `name`, `price`, `lat`, `lon`, `url`, `image`, `last_unit_count` (Integer).

**Phase 2: The Indexer (`runIndexer`) - Runs every 60 minutes**

- Fetch **Source B** (Search API).
- Upsert (Insert or Update) details into the `projects` table using `resource_id` as the key.
- _Note:_ Ensure you map `attributes.resource_id` (int) to the DB `id`.

**Phase 3: The Watcher (`runWatcher`) - Runs every 10 seconds**

- Fetch **Source A** (Counters API).
- Iterate through `buy_units_count`.
- **The Trigger Logic:**
  - Let `currentCount` be the value from API.
  - Let `previousCount` be the value stored in DB for this ID.
  - **CONDITION:** IF (`previousCount` == 0 OR `previousCount` is NULL) AND (`currentCount` \> 0):
    - **ACTION:** Send Telegram Notification immediately (It's a Restock/New Release\!).
  - **Always:** Update `last_unit_count` in DB with `currentCount`.

---

### 3\. Notification Requirements

The Telegram message must be formatted in HTML and include:

- **Header:** 🔥 **عاجل: توفرت قطع جديدة\!** (Urgent: New Units Available\!)
- **Details:** Project Name, Price (formatted with commas), Number of Units.
- **Map:** A direct Google Maps link using `lat` and `lon`.
- **Inline Button:** Text: "🔗 اضغط للحجز فوراً", URL: `https://sakani.sa/app/marketplace/projects/{project_id}` (Note: Use the `id` like "project_1004" for the URL, derived from the resource_id).
- **Smart Fallback:** If the `Watcher` finds an ID that is _not_ in the DB (Indexer hasn't caught it yet), send a notification with "Unknown Project ID: {id} - Count: {count}" and a generic link.

---

### 4\. Code Requirements

- **Clean Code:** Modular functions (`fetchCounters`, `fetchDetails`, `checkUpdates`).
- **Error Handling:** The bot must NOT crash if an API request fails. Log errors and retry next interval.
- **Concurrency:** Use `Promise.all` if necessary, but prioritize the Watcher speed.
- **Environment:** Use `.env` for `TELEGRAM_TOKEN`, `CHAT_IDS`, and API URLs.

**Deliverables:**
Provide the full, production-ready `index.js` file and a `.env` template.
