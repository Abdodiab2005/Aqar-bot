import axios from "axios";

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
      available_units_count: item.attributes.available_units_count || 0,
      min_non_bene_price: item.attributes.min_non_bene_price || 0,
      location_lat: item.attributes.location?.lat || null,
      location_lon: item.attributes.location?.lon || null,
      project_type: item.attributes.project_type,
      views_count: item.attributes.views_count || 0,
      developer_name: item.attributes.developer_name || "",
      banner_url: item.attributes.banner_url || "",
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
   * Generate Sakani project page URL
   * @param {number} resourceId - Resource ID (e.g., 387)
   * @returns {string} Project page URL
   */
  static generateProjectUrl(resourceId) {
    return `https://sakani.sa/app/land-projects/${resourceId}`;
  }
}

export default Scraper;
