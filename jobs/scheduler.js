const {
  sendDailyReport,
  sendWeeklyReport,
} = require("../services/reportService");

class Scheduler {
  constructor() {
    this.jobs = [];
    this.isRunning = false;
  }

  // Calculate milliseconds until next occurrence
  getTimeUntilNext(targetHour, targetMinute, dayOfWeek = null) {
    const now = new Date();
    const target = new Date();

    target.setHours(targetHour, targetMinute, 0, 0);

    // If dayOfWeek is specified (0 = Sunday, 1 = Monday, etc.)
    if (dayOfWeek !== null) {
      const currentDay = now.getDay();
      let daysUntilTarget = dayOfWeek - currentDay;

      if (daysUntilTarget < 0 || (daysUntilTarget === 0 && now >= target)) {
        daysUntilTarget += 7;
      }

      target.setDate(target.getDate() + daysUntilTarget);
    } else {
      // Daily job - if target time has passed today, schedule for tomorrow
      if (now >= target) {
        target.setDate(target.getDate() + 1);
      }
    }

    return target.getTime() - now.getTime();
  }

  // Schedule daily report at 6:00 AM
  scheduleDailyReport() {
    const runDaily = () => {
      const msUntilNext = this.getTimeUntilNext(6, 0); // 6:00 AM

      console.log(
        `Daily report scheduled for: ${new Date(
          Date.now() + msUntilNext
        ).toLocaleString()}`
      );

      setTimeout(async () => {
        console.log("Running daily report job...");
        await sendDailyReport();
        runDaily(); // Schedule next run
      }, msUntilNext);
    };

    runDaily();
    console.log("Daily report scheduler initialized");
  }

  // Schedule weekly report at 7:00 AM on Monday
  scheduleWeeklyReport() {
    const runWeekly = () => {
      const msUntilNext = this.getTimeUntilNext(7, 0, 1); // 7:00 AM on Monday (1 = Monday)

      console.log(
        `Weekly report scheduled for: ${new Date(
          Date.now() + msUntilNext
        ).toLocaleString()}`
      );

      setTimeout(async () => {
        console.log("Running weekly report job...");
        await sendWeeklyReport();
        runWeekly(); // Schedule next run
      }, msUntilNext);
    };

    runWeekly();
    console.log("Weekly report scheduler initialized");
  }

  // Start all scheduled jobs
  start() {
    if (this.isRunning) {
      console.log("Scheduler is already running");
      return;
    }

    console.log("Starting report scheduler...");
    this.scheduleDailyReport();
    this.scheduleWeeklyReport();
    this.isRunning = true;
    console.log("Report scheduler started successfully");
  }
}

// Create singleton instance
const scheduler = new Scheduler();

module.exports = scheduler;
