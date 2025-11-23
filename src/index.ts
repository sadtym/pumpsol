import { logger } from './utils/logger.js';
import { config } from './config.js';
import { fetchNewPairs, getCacheStats } from './services/scanner.js';
import { filterToken } from './services/filter.js';
import { initBot, sendAlert, sendStartup, sendErrorNotification } from './services/telegram.js';
import { startHealthServer } from './utils/health.js';

let scanCount = 0;
let tokensFound = 0;
let tokensPassed = 0;
let lastHealthCheck = Date.now();

async function scanLoop(): Promise<void> {
  try {
    scanCount++;
    logger.info(`\n━━━ Scan #${scanCount} ━━━`);
    
    const pairs = await fetchNewPairs();

    if (pairs.length === 0) {
      logger.info('No new pairs in this scan');
      return;
    }

    tokensFound += pairs.length;
    logger.info(`Processing ${pairs.length} new pair(s)...`);

    for (const pair of pairs) {
      try {
        logger.info(`\n--- Processing: ${pair.baseToken.symbol} ---`);
        
        const filterResult = filterToken(pair);

        if (!filterResult.passed) {
          continue;
        }

        tokensPassed++;
        logger.success(`\n🎯 SAFE TOKEN FOUND: ${pair.baseToken.symbol}`);
        logger.info(`Total passed: ${tokensPassed}/${tokensFound}`);

        const sent = await sendAlert(pair, filterResult);
        
        if (!sent) {
          logger.error(`Failed to send alert for ${pair.baseToken.symbol}`);
        }

        await new Promise(r => setTimeout(r, 1000));

      } catch (error: any) {
        logger.error(`Error processing ${pair.baseToken.symbol}:`, error.message);
      }
    }

    const cacheStats = getCacheStats();
    logger.info(`\nCache: ${cacheStats.size} pairs (oldest: ${cacheStats.oldest}m)`);

  } catch (error: any) {
    logger.error('Error in scan loop:', error.message);
  }
}

function healthCheck(): void {
  const now = Date.now();
  const uptime = Math.floor((now - lastHealthCheck) / 60000);
  
  logger.info(`\n━━━ Health Check ━━━`);
  logger.info(`Uptime: ${uptime} minutes`);
  logger.info(`Scans completed: ${scanCount}`);
  logger.info(`Tokens found: ${tokensFound}`);
  logger.info(`Tokens passed: ${tokensPassed}`);
  logger.info(`Pass rate: ${tokensFound > 0 ? ((tokensPassed / tokensFound) * 100).toFixed(1) : 0}%`);
  
  lastHealthCheck = now;
}

function startScanner(): void {
  logger.info('\n🚀 Scanner started!');
  logger.info(`Poll interval: ${config.scanner.pollInterval}ms (${config.scanner.pollInterval / 1000}s)`);
  logger.info(`Filters: Liq≥$${config.scanner.minLiquidity}, Vol≥$${config.scanner.minVolume5m}, Age≤${config.scanner.maxAgeMinutes}m`);
  logger.info('Press Ctrl+C to stop\n');

  scanLoop();
  setInterval(scanLoop, config.scanner.pollInterval);
  setInterval(healthCheck, 300000);
}

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  Meme Coin Scanner v3.0 - PRODUCTION    ║');
  console.log('║  Hardened • Stable • 24/7 Ready         ║');
  console.log('╚══════════════════════════════════════════╝\n');

  logger.info('Starting health check server...');
  startHealthServer();

  logger.info('Initializing Telegram bot...');
  const botReady = await initBot();

  if (!botReady) {
    logger.error('❌ Failed to initialize bot. Exiting...');
    process.exit(1);
  }

  logger.info('');

  await sendStartup();
  startScanner();
}

process.on('uncaughtException', (error) => {
  logger.error('⚠️ UNCAUGHT EXCEPTION:', error.message);
  logger.error(error.stack || '');
  sendErrorNotification(`Uncaught Exception: ${error.message}`);
  logger.warn('Scanner continues running...');
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('⚠️ UNHANDLED REJECTION:', reason?.message || reason);
  sendErrorNotification(`Unhandled Rejection: ${reason?.message || 'Unknown'}`);
  logger.warn('Scanner continues running...');
});

process.on('SIGINT', () => {
  logger.info('\n\n━━━ Shutdown Signal Received ━━━');
  logger.info(`Total scans: ${scanCount}`);
  logger.info(`Tokens found: ${tokensFound}`);
  logger.info(`Tokens passed: ${tokensPassed}`);
  logger.info('\nShutting down gracefully...\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('\nShutting down gracefully...\n');
  process.exit(0);
});

main().catch(error => {
  logger.error('❌ FATAL ERROR:', error);
  process.exit(1);
});
