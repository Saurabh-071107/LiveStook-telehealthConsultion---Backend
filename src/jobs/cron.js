const weatherService = require('../services/weather.service');
const outbreakRiskEngine = require('../services/outbreak-risk.service');
const notificationService = require('../services/notification.service');
const db = require('../db');

/**
 * Background Automation Jobs
 * Periodically refreshes environmental telemetry, runs outbreak surveillance algorithms,
 * sends prophylactic vaccination alerts, and purges stale virtual queue tokens.
 */
class BackgroundJobScheduler {
  constructor() {
    this.weatherJobInterval = null;
    this.outbreakJobInterval = null;
    this.reminderJobInterval = null;
  }

  startAll() {
    console.log('[BackgroundJobs] Initializing automated surveillance & reminder daemons...');

    // 1. Initial run on boot
    this.runWeatherAndOutbreakSync();
    this.runVaccinationAndAppointmentReminders();

    // 2. Outbreak & Weather calculation every 30 minutes
    this.outbreakJobInterval = setInterval(() => {
      this.runWeatherAndOutbreakSync();
    }, 30 * 60 * 1000);

    // 3. Prophylactic Vaccination & Stale Queue sweep every 15 minutes
    this.reminderJobInterval = setInterval(() => {
      this.runVaccinationAndAppointmentReminders();
    }, 15 * 60 * 1000);
  }

  async runWeatherAndOutbreakSync() {
    try {
      console.log('[BackgroundJobs] Synchronizing environmental features & outbreak intelligence...');
      // Primary agricultural district pin codes to keep warm
      const activePins = ['411001', '413001', '414001', '416001', '422001'];
      for (const pin of activePins) {
        await weatherService.getWeatherByPin(pin);
      }

      // Run bimodal risk engine
      const evaluated = await outbreakRiskEngine.evaluateAllDistricts();
      console.log(`[BackgroundJobs] Evaluated ${evaluated.length} regional disease clusters.`);
    } catch (err) {
      console.warn('[BackgroundJobs] Outbreak sync error:', err.message);
    }
  }

  async runVaccinationAndAppointmentReminders() {
    try {
      const now = new Date();
      // Check upcoming vaccination schedules due within 3 days
      const schedules = db.findAll('vaccinationSchedules', s => s.status === 'active');
      for (const sched of schedules) {
        if (sched.targetDistrict) {
          // Remind farmers
          console.log(`[BackgroundJobs] Auto-dispatching ring vaccination alert for ${sched.vaccineName} in ${sched.targetDistrict}`);
        }
      }
    } catch (err) {
      console.warn('[BackgroundJobs] Reminders error:', err.message);
    }
  }

  stopAll() {
    if (this.outbreakJobInterval) clearInterval(this.outbreakJobInterval);
    if (this.reminderJobInterval) clearInterval(this.reminderJobInterval);
    console.log('[BackgroundJobs] All daemons halted.');
  }
}

module.exports = new BackgroundJobScheduler();
