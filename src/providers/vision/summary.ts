import { Database } from "bun:sqlite";

const db = new Database("./vision-ai.db");

function getSightingSummary() {
  console.log("\n--- AI Vision: Sighting Summary ---");

  // This query aggregates sightings by name
  const query = db.query(`
    SELECT 
      name, 
      COUNT(*) as frequency, 
      MIN(timestamp) as first_seen, 
      MAX(timestamp) as last_seen 
    FROM sightings 
    GROUP BY name 
    ORDER BY last_seen DESC
  `);

  const results = query.all() as any[];

  if (results.length === 0) {
    console.log("No sighting history found.");
    return;
  }

  const tableData = results.map((row) => ({
    Person: row.name,
    Times: row.frequency,
    "First Spotted": new Date(row.first_seen).toLocaleString(),
    "Last Spotted": new Date(row.last_seen).toLocaleString(),
  }));

  console.table(tableData);
}

// Optional: Query specifically for "Today"
function getTodaySummary() {
  const today = db
    .query(
      `
        SELECT name, COUNT(*) as count 
        FROM sightings 
        WHERE timestamp > date('now', 'start of day')
        GROUP BY name
    `,
    )
    .all() as any[];

  console.log("\n--- Activity Today ---");
  today.forEach((row) => {
    console.log(`- ${row.name}: ${row.count} times`);
  });
}

getSightingSummary();
getTodaySummary();
