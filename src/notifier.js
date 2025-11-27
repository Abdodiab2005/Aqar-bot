import TelegramBot from 'node-telegram-bot-api';
import Scraper from './scraper.js';

/**
 * Telegram Notifier for sending land availability alerts
 */
class Notifier {
  constructor(botToken, adminIds) {
    this.bot = new TelegramBot(botToken, { polling: false });
    this.adminIds = adminIds; // Now an array of chat IDs
  }

  /**
   * Send notification about land availability to all admins
   * @param {object} project - Project data
   * @param {string} reason - Notification reason ('new_listing' or 'restocked')
   */
  async sendNotification(project, reason) {
    const messageCaption = this._formatMessage(project, reason);
    const options = this._createMessageOptions(project.id);
    const bannerUrl = project.banner_url;

    for (const chatId of this.adminIds) {
      try {
        if (bannerUrl && bannerUrl.trim() !== "") {
          // Try sending photo with caption
          await this.bot.sendPhoto(chatId, bannerUrl, {
            caption: messageCaption,
            ...options
          });
        } else {
          // No banner, send text only
          await this.bot.sendMessage(chatId, messageCaption, {
            ...options,
            disable_web_page_preview: true
          });
        }
      } catch (error) {
        console.error(`[Telegram Error] Failed to send photo/message to ${chatId}:`, error.message);

        // Fallback: If photo fails, try sending text only
        if (bannerUrl) {
          try {
            await this.bot.sendMessage(chatId, messageCaption, {
              ...options,
              disable_web_page_preview: true
            });
          } catch (retryError) {
            console.error(`[Telegram Critical] Even text fallback failed for ${chatId}`);
          }
        }
      }
    }
  }

  /**
   * Format notification message with HTML (Arabic)
   * @param {object} project - Project data
   * @param {string} reason - Notification reason
   * @returns {string} Formatted HTML message
   */
  _formatMessage(project, reason) {
    const developerName = project.developer_name || 'وزارة الشؤون البلدية والقروية والإسكان';
    const projectType = this._getProjectType(project.project_type);
    const priceFormatted = this._formatNumber(project.min_non_bene_price, true);
    const viewsFormatted = this._formatNumber(project.views_count, false);
    const mapsLink = Scraper.generateMapsLink(project.location);

    let message = `<b>🔥 فرصة عقارية متاحة الآن!</b>\n\n`;
    message += `📍 <b>الاسم:</b> ${this._escapeHtml(project.project_name)}\n`;
    message += `🏢 <b>المطور:</b> ${this._escapeHtml(developerName)}\n`;
    message += `🏷 <b>النوع:</b> ${projectType}\n\n`;
    message += `💰 <b>السعر:</b> ${priceFormatted}\n`;
    message += `⚡️ <b>الوحدات المتاحة:</b> ${project.available_units_count} وحدة\n`;
    message += `👀 <b>المشاهدات:</b> ${viewsFormatted} مشاهدة\n\n`;

    if (mapsLink) {
      message += `🗺 <b>الموقع:</b> <a href="${mapsLink}">عرض على خرائط جوجل</a>\n\n`;
    }

    message += `<code>ID: ${project.id}</code>`;

    return message;
  }

  /**
   * Create message options with inline keyboard
   * @param {string} projectId - Project ID
   * @returns {object} Message options object
   */
  _createMessageOptions(projectId) {
    const projectUrl = Scraper.generateProjectUrl(projectId);

    return {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🔗 احجز الآن عبر سكني',
              url: projectUrl
            }
          ]
        ]
      }
    };
  }

  /**
   * Format number with Arabic locale
   * @param {number} num - Number to format
   * @param {boolean} isCurrency - Whether to format as currency
   * @returns {string} Formatted number string
   */
  _formatNumber(num, isCurrency = false) {
    const options = isCurrency
      ? { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }
      : { style: 'decimal' };
    return new Intl.NumberFormat('ar-SA', options).format(num);
  }

  /**
   * Get project type in Arabic
   * @param {string} type - Project type from API
   * @returns {string} Arabic project type
   */
  _getProjectType(type) {
    if (type === 'lands_moh_land') return 'أرض وزارة إسكان 🇸🇦';
    return type || 'مشروع سكني';
  }

  /**
   * Escape HTML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  /**
   * Send error notification to all admins
   * @param {string} errorMessage - Error message
   */
  async sendErrorNotification(errorMessage) {
    const message = `⚠️ <b>Bot Error</b>\n\n<code>${this._escapeHtml(errorMessage)}</code>`;

    for (const chatId of this.adminIds) {
      try {
        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error(`Failed to send error notification to ${chatId}:`, error.message);
      }
    }
  }
}

export default Notifier;
