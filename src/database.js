import sqlite3 from 'sqlite3';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

/**
 * Database manager for storing and tracking project information
 */
class Database {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Initialize database connection and create tables if needed
   */
  async initialize() {
    // Ensure data directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, async (err) => {
        if (err) {
          reject(err);
        } else {
          try {
            await this._migrateSchema();
            await this._createTables();
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      });
    });
  }

  /**
   * Migrate existing schema to new structure
   */
  async _migrateSchema() {
    return new Promise((resolve, reject) => {
      // Check if old schema exists
      this.db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'", async (err, row) => {
        if (err) {
          reject(err);
          return;
        }

        if (row) {
          // Table exists, check if it has old schema
          this.db.all("PRAGMA table_info(projects)", async (err, columns) => {
            if (err) {
              reject(err);
              return;
            }

            const hasOldSchema = columns.some(col => col.name === 'id' && col.type === 'TEXT');
            const hasNewSchema = columns.some(col => col.name === 'resource_id' && col.type === 'INTEGER');

            if (hasOldSchema || (!hasNewSchema && columns.length > 0)) {
              console.log('🔄 Detected old schema. Dropping table for clean migration...');

              // Drop old table and recreate (simplest approach)
              try {
                await this._dropTable();
                console.log('✅ Old schema removed. New schema will be created.');
                resolve();
              } catch (error) {
                reject(error);
              }
            } else {
              resolve();
            }
          });
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Drop the projects table
   */
  async _dropTable() {
    return new Promise((resolve, reject) => {
      this.db.run('DROP TABLE IF EXISTS projects', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Create projects table if it doesn't exist
   */
  async _createTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS projects (
        resource_id INTEGER PRIMARY KEY,
        project_name TEXT,
        available_units_count INTEGER DEFAULT 0,
        min_non_bene_price REAL,
        location_lat REAL,
        location_lon REAL,
        developer_name TEXT,
        banner_url TEXT,
        views_count INTEGER,
        project_type TEXT,
        last_indexed_at DATETIME,
        last_watched_at DATETIME,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    return new Promise((resolve, reject) => {
      this.db.run(createTableSQL, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Get project by resource_id
   * @param {number} resourceId - The resource ID
   * @returns {Promise<object|null>} Project data or null if not found
   */
  async getProject(resourceId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM projects WHERE resource_id = ?',
        [resourceId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * Get unit count for a resource_id (used by Watcher)
   * @param {number} resourceId - The resource ID
   * @returns {Promise<number|null>} Unit count or null if project not found
   */
  async getUnitCount(resourceId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT available_units_count FROM projects WHERE resource_id = ?',
        [resourceId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row ? row.available_units_count : null);
        }
      );
    });
  }

  /**
   * Upsert project metadata (used by Indexer)
   * Updates all metadata fields except available_units_count
   * @param {object} project - Project data from Search API
   */
  async upsertProjectMetadata(project) {
    const {
      resource_id,
      project_name,
      min_non_bene_price,
      location_lat,
      location_lon,
      developer_name,
      banner_url,
      views_count,
      project_type
    } = project;

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO projects (
          resource_id, project_name, min_non_bene_price, location_lat, location_lon,
          developer_name, banner_url, views_count, project_type, last_indexed_at, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(resource_id) DO UPDATE SET
          project_name = excluded.project_name,
          min_non_bene_price = excluded.min_non_bene_price,
          location_lat = excluded.location_lat,
          location_lon = excluded.location_lon,
          developer_name = excluded.developer_name,
          banner_url = excluded.banner_url,
          views_count = excluded.views_count,
          project_type = excluded.project_type,
          last_indexed_at = CURRENT_TIMESTAMP,
          last_updated = CURRENT_TIMESTAMP`,
        [resource_id, project_name, min_non_bene_price, location_lat, location_lon,
         developer_name, banner_url, views_count, project_type],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Update only the unit count (used by Watcher)
   * @param {number} resourceId - The resource ID
   * @param {number} count - The new unit count
   */
  async updateUnitCount(resourceId, count) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO projects (resource_id, available_units_count, last_watched_at, last_updated)
         VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(resource_id) DO UPDATE SET
           available_units_count = excluded.available_units_count,
           last_watched_at = CURRENT_TIMESTAMP,
           last_updated = CURRENT_TIMESTAMP`,
        [resourceId, count],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Ensure a project row exists (used by Watcher for unknown projects)
   * Creates minimal row that will be filled by Indexer later
   * @param {number} resourceId - The resource ID
   */
  async ensureProjectExists(resourceId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR IGNORE INTO projects (resource_id, last_updated)
         VALUES (?, CURRENT_TIMESTAMP)`,
        [resourceId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Close database connection
   */
  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

export default Database;
