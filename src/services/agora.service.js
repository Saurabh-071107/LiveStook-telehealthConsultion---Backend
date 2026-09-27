const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
const config = require('../config');

/**
 * Agora RTC Token & Call Authorization Service
 * Enforces business rules:
 * 1. Only veterinarian can start consultation calls.
 * 2. Doctor can start call at most 5 minutes before scheduled appointment time.
 * 3. Farmer cannot initiate calls.
 * 4. Tokens are short-lived and tied to specific consultation channels.
 */
class AgoraService {
  /**
   * Validate if call start is authorized based on role and 5-minute pre-call rule
   * @param {Object} appointment
   * @param {Object} user - The requester (must be VET)
   */
  canStartCall(appointment, user) {
    if (!user || (user.role !== 'VETERINARIAN' && user.role !== 'vet')) {
      return {
        allowed: false,
        reason: 'Only a licensed veterinarian can initiate a consultation call. Farmers cannot start calls.'
      };
    }

    if (!appointment || !appointment.startTime) {
      // If walk-in queue with immediate start, allow
      return { allowed: true };
    }

    const apptTime = new Date(appointment.startTime).getTime();
    const now = Date.now();
    const fiveMinutesMs = 5 * 60 * 1000;
    const earliestAllowedStart = apptTime - fiveMinutesMs;

    if (now < earliestAllowedStart) {
      const minutesRemaining = Math.ceil((earliestAllowedStart - now) / 60000);
      return {
        allowed: false,
        reason: `Consultation cannot be started more than 5 minutes before the scheduled appointment time. Please wait ${minutesRemaining} minute(s).`,
        earliestAllowedStart: new Date(earliestAllowedStart).toISOString()
      };
    }

    return { allowed: true };
  }

  /**
   * Generate an Agora RTC Token
   * @param {string} channelName
   * @param {number|string} uid
   * @param {string} role 'PUBLISHER' | 'SUBSCRIBER'
   * @param {number} expireTimeInSeconds (default: 3600 = 1 hour)
   */
  generateRtcToken(channelName, uid = 0, role = 'PUBLISHER', expireTimeInSeconds = 3600) {
    const appId = config.agoraAppId;
    const appCertificate = config.agoraAppCertificate;

    // Deterministic numeric UID for Agora SDK if a string is provided
    let numericUid = typeof uid === 'number' ? uid : 0;
    if (typeof uid === 'string') {
      let hash = 0;
      for (let i = 0; i < uid.length; i++) {
        hash = (hash << 5) - hash + uid.charCodeAt(i);
        hash |= 0;
      }
      numericUid = Math.abs(hash) % 1000000 + 1;
    }

    // Fallback token for local development when credentials are yet to be filled
    if (!appId || !appCertificate) {
      return {
        appId: appId || 'demo-agora-app-id-pashuseva',
        channelName,
        token: `demo-rtc-token-${channelName}-${numericUid}-${Date.now()}`,
        uid: numericUid,
        expiresIn: expireTimeInSeconds
      };
    }

    const rtcRole = role === 'PUBLISHER' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER;
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expireTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      numericUid,
      rtcRole,
      privilegeExpiredTs
    );

    return {
      appId,
      channelName,
      token,
      uid: numericUid,
      expiresIn: expireTimeInSeconds
    };
  }

  /**
   * Format standard channel name
   */
  getChannelName(caseId) {
    return `consultation_${caseId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  /**
   * Format unique human-readable Call ID
   */
  generateCallId() {
    const year = new Date().getFullYear();
    const randomSeq = Math.floor(100000 + Math.random() * 900000);
    return `CALL-${year}-${randomSeq}`;
  }
}

module.exports = new AgoraService();
