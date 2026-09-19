/**
 * Convex Cron Definition for FPL Nusantara BERHADIAH
 * Scheduled syncing with official FPL API:
 * - Daily at 07:00 WIB (00:00 UTC)
 * - Daily at 15:00 WIB (08:00 UTC)
 * - Daily at 16:00 WIB (09:00 UTC)
 * - Every 15 minutes during live matches (1h before to 2.5h after kickoff)
 */

export const convexCronConfig = [
  {
    name: "sync-morning-07-wib",
    schedule: "0 0 * * *", // 00:00 UTC = 07:00 WIB
    description: "Daily morning sync at 07:00 WIB"
  },
  {
    name: "sync-afternoon-15-wib",
    schedule: "0 8 * * *", // 08:00 UTC = 15:00 WIB
    description: "Daily afternoon sync at 15:00 WIB"
  },
  {
    name: "sync-afternoon-16-wib",
    schedule: "0 9 * * *", // 09:00 UTC = 16:00 WIB
    description: "Daily afternoon sync at 16:00 WIB"
  },
  {
    name: "sync-live-matchday-15m",
    schedule: "*/15 * * * *", // Checked dynamically based on active Premier League fixture window
    description: "Every 15 min during active Premier League matches"
  }
];
