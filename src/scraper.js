import axios from "axios";
import fs from "fs";
import path from "path";

// Ensure logs directory exists
const logsDir = "./logs";
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * API Scraper for fetching land availability data
 * Hybrid Architecture: Supports both Search API (metadata) and Counters API (unit counts)
 */
class Scraper {
  constructor(searchApiUrl, countersApiUrl) {
    this.searchApiUrl = searchApiUrl;
    this.countersApiUrl = countersApiUrl;
  }

  /**
   * Fetch projects from Search API (used by Indexer)
   * @returns {Promise<Array>} Array of normalized project objects with metadata
   */
  async fetchSearchAPI() {
    try {
      const response = await axios.get(this.searchApiUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        timeout: 30000, // 30 seconds timeout
      });

      if (!response.data || !response.data.data) {
        throw new Error("Invalid Search API response structure");
      }

      // Save raw API response to log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filepath = path.join(
        logsDir,
        `${timestamp}_search_api_raw_response.json`
      );
      fs.writeFileSync(
        filepath,
        JSON.stringify(response.data, null, 2),
        "utf8"
      );
      console.log(`📝 Saved raw Search API response: ${filepath}`);

      return this._normalizeSearchResponse(response.data.data);
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Search API Error: ${error.response.status} - ${error.response.statusText}`
        );
      } else if (error.request) {
        throw new Error("Network Error: No response received from Search API");
      } else {
        throw new Error(`Search API Error: ${error.message}`);
      }
    }
  }

  /**
   * Fetch unit counts from Counters API (used by Watcher)
   * @returns {Promise<Array>} Array of {resource_id, count} objects
   */
  async fetchCountersAPI() {
    try {
      const response = await axios.get(this.countersApiUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        timeout: 15000, // 15 seconds timeout (faster endpoint)
      });

      if (!response.data || !response.data.buy_units_count) {
        throw new Error("Invalid Counters API response structure");
      }

      // Save raw API response to log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filepath = path.join(
        logsDir,
        `${timestamp}_counters_api_raw_response.json`
      );
      fs.writeFileSync(
        filepath,
        JSON.stringify(response.data, null, 2),
        "utf8"
      );
      console.log(`📝 Saved raw Counters API response: ${filepath}`);

      return this._normalizeCountersResponse(response.data);
    } catch (error) {
      if (error.response) {
        throw new Error(
          `Counters API Error: ${error.response.status} - ${error.response.statusText}`
        );
      } else if (error.request) {
        throw new Error(
          "Network Error: No response received from Counters API"
        );
      } else {
        throw new Error(`Counters API Error: ${error.message}`);
      }
    }
  }

  /**
   * Normalize Search API response into structured project objects
   * @param {Array} rawData - Raw data from Search API
   * @returns {Array} Normalized project objects with all metadata
   */
  _normalizeSearchResponse(rawData) {
    return rawData.map((item) => ({
      resource_id: item.attributes.resource_id,
      project_name: item.attributes.project_name,
      available_units_count: item.attributes.units_statistic_data?.available_units_count || 0,
      min_non_bene_price: item.attributes.units_statistic_data?.min_non_bene_price || 0,
      location_lat: item.attributes.location?.lat || null,
      location_lon: item.attributes.location?.lon || null,
      city: item.attributes.city_obj?.name_ar || "",
      region: item.attributes.region_obj?.name_ar || "",
      project_type: item.attributes.project_type,
      views_count: item.attributes.views_count || 0,
      developer_name: item.attributes.developer_name || "",
      banner_url: item.attributes.banner_url || "",
      bookable: item.attributes.bookable || false,
    }));
  }

  /**
   * Normalize Counters API response into array of resource_id/count pairs
   * @param {object} data - Raw data from Counters API
   * @returns {Array} Array of {resource_id: number, count: number} objects
   */
  _normalizeCountersResponse(data) {
    const buyUnitsCount = data.buy_units_count || {};
    return Object.entries(buyUnitsCount).map(([id, count]) => ({
      resource_id: parseInt(id, 10),
      count: parseInt(count, 10) || 0,
    }));
  }

  /**
   * Generate Google Maps link from coordinates
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @returns {string|null} Google Maps URL or null if coordinates invalid
   */
  static generateMapsLink(lat, lon) {
    if (!lat || !lon) {
      return null;
    }
    return `https://www.google.com/maps?q=${lat},${lon}`;
  }

  /**
   * Fetch and validate project details from validation API
   * @param {number} resourceId - Resource ID to validate
   * @returns {Promise<object|null>} Project data if valid, null if invalid
   */
  async validateProject(resourceId) {
    try {
      const validationUrl = `https://sakani.sa/mainIntermediaryApi/v4/projects/${resourceId}?include=amenities`;

      console.log(`🔍 Validating project ${resourceId}...`);

      const response = await axios.get(validationUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
        },
        timeout: 10000, // 10 seconds timeout
      });

      if (!response.data || !response.data.data) {
        console.log(`❌ Invalid validation response for ${resourceId}`);
        return null;
      }

      const project = response.data.data;
      const attrs = project.attributes;

      // Save raw validation response to log
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filepath = path.join(
        logsDir,
        `${timestamp}_validation_${resourceId}.json`
      );
      fs.writeFileSync(
        filepath,
        JSON.stringify(response.data, null, 2),
        "utf8"
      );
      console.log(`📝 Saved validation response: ${filepath}`);

      // Critical validation checks
      const isBookable = attrs.bookable === true;
      const availableUnits = attrs.units_statistic_data?.available_units_count || 0;
      const hasUnits = availableUnits > 0;

      console.log(`   bookable: ${isBookable}`);
      console.log(`   available_units: ${availableUnits}`);

      // Both conditions must be true
      if (!isBookable || !hasUnits) {
        console.log(`❌ Validation failed for ${resourceId}: bookable=${isBookable}, units=${availableUnits}`);
        return null;
      }

      console.log(`✅ Validation passed for ${resourceId}`);

      // Extract and normalize data
      const location = attrs.location || {};
      return {
        resource_id: resourceId,
        project_name: attrs.name,
        available_units_count: availableUnits,
        min_non_bene_price: attrs.units_statistic_data?.min_non_bene_price || 0,
        location_lat: location.lat || null,
        location_lon: location.lon || null,
        city: attrs.city_obj?.name_ar || "",
        region: attrs.region_obj?.name_ar || "",
        developer_name: attrs.developer_name || "",
        banner_url: attrs.banner_url || "",
        views_count: attrs.views_count || 0,
        project_type: attrs.project_type || "",
        bookable: attrs.bookable,
      };
    } catch (error) {
      console.error(`❌ Validation error for ${resourceId}:`, error.message);

      // Log validation errors
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filepath = path.join(
        logsDir,
        `${timestamp}_validation_error_${resourceId}.json`
      );
      fs.writeFileSync(
        filepath,
        JSON.stringify({ error: error.message, stack: error.stack }, null, 2),
        "utf8"
      );

      return null;
    }
  }

  /**
   * Generate Sakani project page URL
   * @param {number} resourceId - Resource ID (e.g., 387)
   * @returns {string} Project page URL
   */
  static generateProjectUrl(resourceId) {
    return `https://sakani.sa/app/land-projects/${resourceId}`;
  }
}

export default Scraper;
