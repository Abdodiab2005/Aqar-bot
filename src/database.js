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

            const hasOldSchema = columns.some(col => col.name === 'units_count' || col.name === 'price');
            const hasNewSchema = columns.some(col => col.name === 'available_units_count');

            if (hasOldSchema && !hasNewSchema) {
              console.log('📦 Migrating database schema to new structure...');

              // Drop old table and recreate (simplest approach)
              try {
                await this._dropTable();
                console.log('✅ Old schema dropped, new schema will be created');
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
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        available_units_count INTEGER NOT NULL,
        min_non_bene_price REAL NOT NULL,
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
   * Get project by ID
   * @param {string} projectId - The project ID
   * @returns {Promise<object|null>} Project data or null if not found
   */
  async getProject(projectId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM projects WHERE id = ?',
        [projectId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  /**
   * Insert new project into database
   * @param {object} project - Project data
   */
  async insertProject(project) {
    const { id, project_name, available_units_count, min_non_bene_price } = project;

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO projects (id, project_name, available_units_count, min_non_bene_price, last_updated)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, project_name, available_units_count, min_non_bene_price],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Update existing project
   * @param {object} project - Project data
   */
  async updateProject(project) {
    const { id, project_name, available_units_count, min_non_bene_price } = project;

    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE projects
         SET project_name = ?, available_units_count = ?, min_non_bene_price = ?, last_updated = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [project_name, available_units_count, min_non_bene_price, id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  /**
   * Check if project needs notification
   * Returns true for new listings or restocked items
   * @param {object} apiProject - Project from API
   * @returns {Promise<object>} Object with shouldNotify flag and reason
   */
  async shouldNotify(apiProject) {
    const existingProject = await this.getProject(apiProject.id);

    // Case A: New opportunity - NOT in DB AND available_units_count > 0
    if (!existingProject && apiProject.available_units_count > 0) {
      return {
        shouldNotify: true,
        reason: 'new_listing',
        previousUnits: 0
      };
    }

    // Case B: Restock alert - IS in DB, previous was 0, current > 0
    if (existingProject && existingProject.available_units_count === 0 && apiProject.available_units_count > 0) {
      return {
        shouldNotify: true,
        reason: 'restocked',
        previousUnits: existingProject.available_units_count
      };
    }

    return {
      shouldNotify: false,
      reason: null,
      previousUnits: existingProject ? existingProject.available_units_count : 0
    };
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
