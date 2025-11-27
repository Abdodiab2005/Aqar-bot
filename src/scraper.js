import axios from 'axios';

/**
 * API Scraper for fetching land availability data
 */
class Scraper {
  constructor(apiUrl) {
    this.apiUrl = apiUrl;
  }

  /**
   * Fetch projects from API
   * @returns {Promise<Array>} Array of normalized project objects
   */
  async fetchProjects() {
    try {
      const response = await axios.get(this.apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 30000 // 30 seconds timeout
      });

      if (!response.data || !response.data.data) {
        throw new Error('Invalid API response structure');
      }

      return this._normalizeProjects(response.data.data);
    } catch (error) {
      if (error.response) {
        throw new Error(`API Error: ${error.response.status} - ${error.response.statusText}`);
      } else if (error.request) {
        throw new Error('Network Error: No response received from API');
      } else {
        throw new Error(`Scraper Error: ${error.message}`);
      }
    }
  }

  /**
   * Normalize API response into structured project objects
   * @param {Array} rawData - Raw data from API
   * @returns {Array} Normalized project objects
   */
  _normalizeProjects(rawData) {
    return rawData.map(item => ({
      id: item.id,
      project_name: item.attributes.project_name,
      available_units_count: item.attributes.available_units_count || 0,
      min_non_bene_price: item.attributes.min_non_bene_price || 0,
      location: item.attributes.location,
      project_type: item.attributes.project_type,
      views_count: item.attributes.views_count || 0,
      developer_name: item.attributes.developer_name || '',
      banner_url: item.attributes.banner_url || ''
    }));
  }

  /**
   * Generate Google Maps link from coordinates
   * @param {object} location - Location object with lat and lon
   * @returns {string} Google Maps URL
   */
  static generateMapsLink(location) {
    if (!location || !location.lat || !location.lon) {
      return null;
    }
    return `https://www.google.com/maps?q=${location.lat},${location.lon}`;
  }

  /**
   * Generate Sakani project page URL
   * @param {string} projectId - Project ID (e.g., "project_387")
   * @returns {string} Project page URL
   */
  static generateProjectUrl(projectId) {
    // Extract numeric ID from "project_XXX" format
    const numericId = projectId.replace('project_', '');
    return `https://sakani.sa/app/marketplace/projects/${numericId}`;
  }
}

export default Scraper;
