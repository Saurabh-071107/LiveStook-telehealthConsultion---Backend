const config = require('../config');
const { AuditLog } = require('../models');
const mongo = require('../db/mongo');

/**
 * OneSignal & Push Notification Service
 * Dispatches targeted multi-channel push notifications to Farmers, Vets, and Admin.
 */
class NotificationService {
  /**
   * Send notification via OneSignal REST API
   * @param {Object} options
   * @param {Array<string>} [options.userIds]
   * @param {Array<string>} [options.segments] e.g. ['Subscribed Users', 'Veterinarians']
   * @param {string} options.title
   * @param {string} options.message
   * @param {Object} [options.data]
   */
  async sendNotification({ userIds, segments, title, message, data = {} }) {
    console.log(`[Notification] [${title}] ${message} -> ${userIds ? userIds.join(', ') : segments}`);

    // Log to Audit trail
    if (mongo.isConnected) {
      try {
        await AuditLog.create({
          actorRole: 'SYSTEM',
          action: 'PUSH_NOTIFICATION',
          entityType: 'NOTIFICATION',
          details: { title, message, userIds, segments, data }
        });
      } catch (_) {}
    }

    if (!config.oneSignalAppId || !config.oneSignalRestApiKey) {
      // In dev or until keys provided, successfully logs dispatch
      return { success: true, simulated: true, recipientCount: (userIds || segments || []).length };
    }

    try {
      const payload = {
        app_id: config.oneSignalAppId,
        headings: { en: title },
        contents: { en: message },
        data
      };

      if (userIds && userIds.length > 0) {
        payload.include_external_user_ids = userIds;
      } else if (segments && segments.length > 0) {
        payload.included_segments = segments;
      } else {
        payload.included_segments = ['Subscribed Users'];
      }

      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Basic ${config.oneSignalRestApiKey}`
        },
        body: JSON.stringify(payload)
      });

      const responseData = await res.json();
      return { success: res.ok, data: responseData };
    } catch (err) {
      console.warn(`[OneSignal Error] Failed to send push: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // Pre-configured notification triggers
  async notifyCaseAssigned(vetId, caseId, animalType) {
    return this.sendNotification({
      userIds: [vetId.toString()],
      title: 'New Clinical Case Assigned',
      message: `Emergency consultation assigned for ${animalType} (${caseId}). Please review symptoms and accept.`,
      data: { type: 'CASE_ASSIGNED', caseId }
    });
  }

  async notifyConsultationReady(farmerId, caseId) {
    return this.sendNotification({
      userIds: [farmerId.toString()],
      title: 'Veterinarian is Ready',
      message: `Dr. has initiated your video consultation for Case ${caseId}. Tap to join now.`,
      data: { type: 'CONSULTATION_STARTED', caseId }
    });
  }

  async notifyTestReportReady(vetId, farmerId, testBookingId) {
    await this.sendNotification({
      userIds: [farmerId.toString()],
      title: 'Laboratory Diagnostic Report Ready',
      message: `The lab test report for booking #${testBookingId} is now available in your records.`,
      data: { type: 'REPORT_AVAILABLE', testBookingId }
    });
    if (vetId) {
      await this.sendNotification({
        userIds: [vetId.toString()],
        title: 'Diagnostic Test Report Available',
        message: `Lab results uploaded for test booking #${testBookingId}. Ready for final diagnosis.`,
        data: { type: 'REPORT_AVAILABLE', testBookingId }
      });
    }
  }

  async notifyOutbreakAlert(district, diseaseCategory, riskCategory) {
    return this.sendNotification({
      segments: ['Subscribed Users'],
      title: `Biosecurity Advisory: ${riskCategory} Risk in ${district}`,
      message: `Potential ${diseaseCategory} risk elevated in your area. Check surveillance advisories.`,
      data: { type: 'OUTBREAK_WARNING', district, diseaseCategory, riskCategory }
    });
  }
}

module.exports = new NotificationService();
