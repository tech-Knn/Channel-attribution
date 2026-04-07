'use strict';

require('dotenv').config();

const { fetchRevenueData } = require('../src/workers/afsClient');

async function test() {
  console.log('\n── AFS Client Integration Test ──────────────────────\n');

  // Check all required env vars
  const required = ['ADSENSE_PUBLISHER_ID', 'ADSENSE_CLIENT_ID', 'ADSENSE_CLIENT_SECRET', 'ADSENSE_REFRESH_TOKEN'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('❌ Missing env vars:', missing.join(', '));
    process.exit(1);
  }
  console.log('✓ All env vars present\n');

  // Pull today's revenue
  const endTime = new Date();
  const startTime = new Date();
  startTime.setHours(0, 0, 0, 0); // start of today

  console.log(`Pulling revenue for: ${startTime.toISOString().slice(0, 10)}`);
  console.log(`Publisher: ${process.env.ADSENSE_PUBLISHER_ID}\n`);

  try {
    const data = await fetchRevenueData(
      process.env.ADSENSE_PUBLISHER_ID,
      null,
      startTime,
      endTime,
    );

    if (data.length === 0) {
      console.log('⚠️  No revenue data returned — API connected OK but no data for today yet.');
      console.log('    This is normal early in the day or if channels have no traffic.\n');
    } else {
      console.log(`✓ Got ${data.length} channel(s) with revenue:\n`);
      data.forEach((row, i) => {
        console.log(
          `  [${i + 1}] channelId: ${row.channelId} | ` +
          `impressions: ${row.impressions} | clicks: ${row.clicks} | revenue: $${row.revenue.toFixed(4)}`
        );
      });
    }

    console.log('\n✅ AFS Client integration working!\n');
  } catch (err) {
    console.error('\n❌ AFS Client error:', err.message, '\n');
    process.exit(1);
  }
}

test();
