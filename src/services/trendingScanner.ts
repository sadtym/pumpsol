import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { fetchLatestBoosts, fetchTopBoosts, fetchCommunityTakeovers, getTokenPairData, BoostToken, CommunityTakeover } from './dexscreenerV1.js';
import { filterToken, FilterResult } from './filter.js';
import { sendAlert } from './telegram.js';
import { analyzeTokenStrategies, getStrategyStats } from './strategies.js';
import { updateStats } from '../utils/health.js';

interface TrendingToken {
  type: 'boost' | 'top' | 'takeover';
  token: BoostToken | CommunityTakeover;
  pairData?: any;
  filterResult?: FilterResult;
}

let scanCount = 0;
let tokensFound = 0;
let tokensPassed = 0;
const seenTokens = new Set<string>();
let isFirstScan = true; // Flag to skip alerts on first scan

async function processTrendingToken(trending: TrendingToken, sendNotification: boolean = true): Promise<boolean> {
  try {
    const token = trending.token;
    const tokenAddress = token.tokenAddress;
    const chainId = token.chainId;
    
    // Skip if already processed
    const tokenKey = `${chainId}:${tokenAddress}`;
    if (seenTokens.has(tokenKey)) {
      return false;
    }
    
    seenTokens.add(tokenKey);
    
    // Limit seen tokens cache
    if (seenTokens.size > 1000) {
      const keys = Array.from(seenTokens);
      keys.slice(0, 500).forEach(k => seenTokens.delete(k));
    }
    
    // Skip alert if first scan (just collect data)
    if (isFirstScan) {
      logger.info(`[FIRST SCAN] Collecting ${tokenAddress} without alert`);
      return false;
    }
    
    // Get pair data for additional info
    let pairData = null;
    try {
      pairData = await getTokenPairData(chainId, tokenAddress);
    } catch (e) {
      logger.debug(`Could not fetch pair data for ${tokenAddress}`);
    }
    
    // If it's a boost token, we have more data
    if ('marketCap' in token || 'liquidity' in token || 'price' in token) {
      const boostToken = token as BoostToken;
      
      // Build filter result from available data
      const filterResult: FilterResult = {
        passed: true,
        warnings: [],
        security: null,
        stats: {
          liquidity: boostToken.liquidity || 0,
          volume5m: 0,
          volume24h: 0,
          priceChange: boostToken.priceChange?.h24 || 0
        }
      };
      
      // Apply basic filters based on available data
      if (boostToken.liquidity && boostToken.liquidity < config.scanner.minLiquidity) {
        logger.info(`Skipping ${tokenAddress}: Low liquidity ($${boostToken.liquidity} < $${config.scanner.minLiquidity})`);
        return false;
      }
      
      // Stricter market cap filter - at least $50k
      if (boostToken.marketCap && boostToken.marketCap < 50000) {
        logger.info(`Skipping ${tokenAddress}: Low market cap ($${boostToken.marketCap} < $50k)`);
        return false;
      }
      
      // Check for honeypot pattern - extreme price changes with low volume
      if (boostToken.priceChange) {
        const priceChange = Math.abs(boostToken.priceChange.h24);
        if (priceChange > 500 && (!boostToken.liquidity || boostToken.liquidity < 5000)) {
          logger.info(`Skipping ${tokenAddress}: Honeypot pattern detected (${priceChange}% change, low liquidity)`);
          return false;
        }
      }
      
      // Minimum 2 active boosts to filter out low-quality tokens
      if (!boostToken.boosts || boostToken.boosts.active < 2) {
        logger.info(`Skipping ${tokenAddress}: Low boost count (${boostToken.boosts?.active || 0} < 2)`);
        return false;
      }
      
      // Check if it has active boosts
      if (boostToken.boosts && boostToken.boosts.active > 0) {
        logger.success(`🎯 Found boosted token: ${tokenAddress} (${boostToken.boosts.active} active boosts, MC: $${(boostToken.marketCap || 0)/1000}k)`);
        
        // Only send notification if enabled
        if (sendNotification) {
          const message = formatBoostAlert(boostToken);
          await sendBoostAlert(message);
          
          // Also run strategy analysis for this token
          await runStrategyAnalysis(tokenAddress, boostToken);
        }
        
        return true;
      }
    }
    
    // Handle community takeover
    if ('claimDate' in token) {
      const takeover = token as CommunityTakeover;
      logger.success(`🏴 Found community takeover: ${tokenAddress}`);
      
      // Only send notification if enabled
      if (sendNotification) {
        const message = formatTakeoverAlert(takeover);
        await sendBoostAlert(message);
        
        // Also run strategy analysis for this token
        await runStrategyAnalysis(tokenAddress, undefined, takeover);
      }
      
      return true;
    }
    
    return false;
    
  } catch (error) {
    logger.error(`Error processing trending token:`, error);
    return false;
  }
}

function formatBoostAlert(token: BoostToken): string {
  const symbol = token.links?.find(l => l.type === 'symbol')?.label || token.tokenAddress.slice(0, 8);
  const name = token.description || symbol;
  
  let msg = `🚀 <b>NEW BOOSTED TOKEN</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `<b>Chain:</b> ${token.chainId}\n`;
  msg += `<b>Token:</b> ${symbol}\n`;
  
  if (token.price) {
    msg += `<b>Price:</b> $${token.price}\n`;
  }
  
  if (token.marketCap) {
    msg += `<b>Market Cap:</b> $${formatNumber(token.marketCap)}\n`;
  }
  
  if (token.liquidity) {
    msg += `<b>Liquidity:</b> $${formatNumber(token.liquidity)}\n`;
  }
  
  if (token.boosts) {
    msg += `<b>Active Boosts:</b> ${token.boosts.active}\n`;
    msg += `<b>Boost Rank:</b> #${token.boosts.rank}\n`;
  }
  
  if (token.priceChange) {
    const change = token.priceChange.h24;
    const sign = change >= 0 ? '+' : '';
    msg += `<b>24h Change:</b> ${sign}${change.toFixed(2)}%\n`;
  }
  
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>📊 Contract:</b>\n`;
  msg += `<code>${token.tokenAddress}</code>\n\n`;
  msg += `🔗 <a href="${token.url}">📈 View Chart</a>\n\n`;
  msg += `<i>⚠️ DYOR: High risk investment. Not financial advice.</i>`;
  
  return msg;
}

function formatTakeoverAlert(takeover: CommunityTakeover): string {
  let msg = `🏴 <b>COMMUNITY TAKEOVER DETECTED</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `<b>Chain:</b> ${takeover.chainId}\n`;
  msg += `<b>Token:</b> ${takeover.description || takeover.tokenAddress.slice(0, 8)}\n`;
  
  if (takeover.claimDate) {
    msg += `<b>Claim Date:</b> ${new Date(takeover.claimDate).toLocaleDateString()}\n`;
  }
  
  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>📊 Contract:</b>\n`;
  msg += `<code>${takeover.tokenAddress}</code>\n\n`;
  msg += `🔗 <a href="${takeover.url}">📈 View Chart</a>\n\n`;
  msg += `<i>⚠️ Community Takeovers can be risky. DYOR!</i>`;
  
  return msg;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(2)}k`;
  return `$${num.toFixed(2)}`;
}

async function sendBoostAlert(message: string): Promise<boolean> {
  try {
    const { initBot } = await import('./telegram.js');
    const bot = await initBot();
    
    if (!bot) {
      logger.error('Telegram bot not initialized');
      return false;
    }
    
    const { Telegraf } = await import('telegraf');
    const telegramBot = new Telegraf(config.telegram.botToken);
    
    await telegramBot.telegram.sendMessage(config.telegram.channelId, message, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    });
    
    logger.success('Boost/Takeover alert sent to Telegram');
    return true;
  } catch (error) {
    logger.error('Failed to send boost alert:', error);
    return false;
  }
}

/**
 * Run strategy analysis and send alerts if any strategy triggers
 */
async function runStrategyAnalysis(
  tokenAddress: string, 
  boostToken?: BoostToken,
  takeover?: CommunityTakeover
): Promise<void> {
  try {
    // Get additional pair data for more accurate analysis
    let pairData = null;
    try {
      pairData = await getTokenPairData('solana', tokenAddress);
    } catch (e) {
      // Pair data not available, use token data
    }
    
    // Extract available data
    const volume = pairData?.volume?.h24 || boostToken?.liquidity || 0;
    const liquidity = pairData?.liquidity?.usd || boostToken?.liquidity || 0;
    const marketCap = pairData?.fdv || boostToken?.marketCap || 0;
    const price = pairData?.priceUsd || boostToken?.price || 0;
    const priceChange5m = pairData?.priceChange?.m5 || 0;
    const priceChange1h = pairData?.priceChange?.h1 || 0;
    const priceChange24h = pairData?.priceChange?.h24 || boostToken?.priceChange?.h24 || 0;
    
    // Run strategy analysis
    const result = await analyzeTokenStrategies(
      tokenAddress,
      volume,
      liquidity,
      marketCap,
      price,
      priceChange5m,
      priceChange1h,
      priceChange24h,
      pairData?.pairAddress // Pass pair address for historical data
    );
    
    // Send alerts for triggered strategies
    if (result.triggered && result.messages.length > 0) {
      logger.success(`🎯 Strategy triggered for ${tokenAddress}: ${result.messages.length} alerts`);
      
      for (const message of result.messages) {
        await sendBoostAlert(message);
        // Rate limit between strategy alerts
        await new Promise(r => setTimeout(r, 300));
      }
    }
  } catch (error) {
    logger.error(`Error in strategy analysis for ${tokenAddress}:`, error);
  }
}

export async function scanTrendingTokens(): Promise<void> {
  try {
    scanCount++;
    
    // Mark first scan as complete after it finishes
    const isFirstScanThisRun = isFirstScan;
    if (isFirstScan) {
      isFirstScan = false;
      logger.info(`\n━━━ INITIAL SCAN - Collecting data only (no alerts) ━━━`);
    } else {
      logger.info(`\n━━━ Trending Scan #${scanCount - 1} ━━━`);
    }
    
    const allTrending: TrendingToken[] = [];
    
    // Fetch all data in parallel
    const [latestBoosts, topBoosts, takeovers] = await Promise.all([
      fetchLatestBoosts(),
      fetchTopBoosts(),
      fetchCommunityTakeovers()
    ]);
    
    logger.info(`Latest Boosts: ${latestBoosts.length}, Top Boosts: ${topBoosts.length}, Takeovers: ${takeovers.length}`);
    
    // Process latest boosts
    for (const token of latestBoosts) {
      allTrending.push({ type: 'boost', token });
    }
    
    // Process top boosts (add to trending if not in latest)
    for (const token of topBoosts) {
      const tokenKey = `${token.chainId}:${token.tokenAddress}`;
      if (!seenTokens.has(tokenKey)) {
        allTrending.push({ type: 'top', token });
      }
    }
    
    // Process community takeovers
    for (const token of takeovers) {
      allTrending.push({ type: 'takeover', token });
    }
    
    if (allTrending.length === 0) {
      logger.info('No trending tokens found');
      return;
    }
    
    tokensFound += allTrending.length;
    logger.info(`Processing ${allTrending.length} trending token(s)...`);
    
    // Only send notifications if not first scan
    const sendNotification = !isFirstScanThisRun;
    
    // Process each trending token
    for (const trending of allTrending) {
      try {
        const processed = await processTrendingToken(trending, sendNotification);
        if (processed) {
          tokensPassed++;
        }
      } catch (error) {
        logger.error(`Error processing trending token:`, error);
      }
      
      // Rate limiting between alerts
      await new Promise(r => setTimeout(r, 500));
    }
    
    logger.info(`\nStats: Found ${tokensFound}, Passed ${tokensPassed}`);
    
    // Update dashboard stats
    updateStats(scanCount, tokensFound, tokensPassed);
    
  } catch (error) {
    logger.error('Error in trending scan:', error);
  }
}

export async function startTrendingScanner(): Promise<void> {
  logger.info('\n🚀 Starting Trending Tokens Scanner (V1 API)...');
  logger.info(`Poll interval: ${config.scanner.pollInterval}ms`);
  
  // Initial scan
  await scanTrendingTokens();
  
  // Set up interval
  setInterval(scanTrendingTokens, config.scanner.pollInterval);
}
