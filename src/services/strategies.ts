import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { fetchTokenHistory, CandleData } from './dexscreenerV1.js';
import { updateToken, addAlert, loadDatabase, getDatabaseStats } from './database.js';

// Price history for momentum detection
interface PricePoint {
  price: number;
  timestamp: number;
  volume: number;
}

interface TokenHistory {
  address: string;
  prices: PricePoint[];
  firstSeen: number;
  lastSeen: number;
  historicalLoaded: boolean;
}

// In-memory storage for token price history
const tokenHistory = new Map<string, TokenHistory>();

// Strategy configuration
interface StrategyConfig {
  enabled: boolean;
  minVolumeSpike: number; // How many times above average
  minMomentumPercent: number; // Minimum % bounce
  maxPullbackPercent: number; // Maximum % pullback before signal
  minPriceChangePercent: number; // Minimum price change
  useHistoricalData: boolean; // Fetch historical data from API
}

const defaultStrategyConfig: StrategyConfig = {
  enabled: true,
  minVolumeSpike: 3, // Volume 3x above average
  minMomentumPercent: 10, // 10% bounce from low
  maxPullbackPercent: 40, // Max 40% pullback from ATH
  minPriceChangePercent: 5, // 5% minimum price change
  useHistoricalData: true, // Use historical data from DexScreener
};

/**
 * Calculate moving average
 */
function calculateMA(prices: number[], period: number): number {
  if (prices.length < period) {
    return prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  }
  const recentPrices = prices.slice(-period);
  return recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
}

/**
 * Detect local high and low in price history
 */
function detectLocalExtrema(prices: PricePoint[]): { localHigh: number; localLow: number; highIndex: number; lowIndex: number } | null {
  if (prices.length < 5) return null;
  
  let localHigh = 0;
  let localLow = Infinity;
  let highIndex = 0;
  let lowIndex = 0;
  
  for (let i = 2; i < prices.length - 2; i++) {
    if (prices[i].price > prices[i-1].price && prices[i].price > prices[i-2].price &&
        prices[i].price > prices[i+1].price && prices[i].price > prices[i+2].price) {
      if (prices[i].price > localHigh) {
        localHigh = prices[i].price;
        highIndex = i;
      }
    }
    if (prices[i].price < prices[i-1].price && prices[i].price < prices[i-2].price &&
        prices[i].price < prices[i+1].price && prices[i].price < prices[i+2].price) {
      if (prices[i].price < localLow) {
        localLow = prices[i].price;
        lowIndex = i;
      }
    }
  }
  
  return { localHigh, localLow, highIndex, lowIndex };
}

/**
 * Load historical data for a token from DexScreener API
 */
async function loadHistoricalData(address: string, pairAddress?: string): Promise<PricePoint[]> {
  if (!pairAddress) {
    // Use address as pair address for Solana
    pairAddress = address;
  }
  
  try {
    // Fetch 1h candles for the last 100 hours
    const candles = await fetchTokenHistory('solana', pairAddress, '1h', 100);
    
    if (candles && candles.length > 0) {
      // Convert candles to price points
      const pricePoints: PricePoint[] = candles.map(candle => ({
        price: candle.close,
        timestamp: candle.time * 1000, // Convert to milliseconds
        volume: candle.volume
      }));
      
      logger.info(`📊 Loaded ${pricePoints.length} historical candles for ${address.slice(0, 8)}...`);
      return pricePoints;
    }
  } catch (error) {
    logger.error(`Failed to load historical data for ${address}:`, error);
  }
  
  return [];
}

/**
 * Update token price history - with historical data support
 */
export async function updateTokenHistory(
  address: string, 
  price: number, 
  volume: number,
  pairAddress?: string
): Promise<void> {
  const now = Date.now();
  let history = tokenHistory.get(address);
  
  if (!history) {
    history = {
      address,
      prices: [],
      firstSeen: now,
      lastSeen: now,
      historicalLoaded: false
    };
    tokenHistory.set(address, history);
    
    // Load historical data for new tokens
    if (defaultStrategyConfig.useHistoricalData) {
      const historicalPrices = await loadHistoricalData(address, pairAddress);
      if (historicalPrices.length > 0) {
        history.prices = historicalPrices;
        history.historicalLoaded = true;
      }
    }
  }
  
  // Add new price point if not duplicate
  const lastPrice = history.prices[history.prices.length - 1];
  if (!lastPrice || lastPrice.price !== price) {
    history.prices.push({ price, timestamp: now, volume });
  }
  history.lastSeen = now;
  
  // Keep only last 200 price points (including historical)
  if (history.prices.length > 200) {
    history.prices = history.prices.slice(-200);
  }
  
  // Save to database for long-term analysis
  try {
    updateToken(address, {
      price,
      volume,
      marketCap: 0 // Will be updated separately
    });
  } catch (error) {
    logger.debug('Database update failed:', error);
  }
  
  // Cleanup old tokens (not seen in 30 minutes)
  const thirtyMinutesAgo = now - 30 * 60 * 1000;
  for (const [addr, hist] of tokenHistory) {
    if (hist.lastSeen < thirtyMinutesAgo) {
      tokenHistory.delete(addr);
    }
  }
}

/**
 * Strategy 1: Volume Spike Detection
 * Detect when volume suddenly increases significantly
 */
export async function detectVolumeSpike(
  address: string, 
  currentVolume: number, 
  currentPrice: number,
  priceChange: number
): Promise<{ triggered: boolean; message: string; details: any }> {
  const history = tokenHistory.get(address);
  const cfg = defaultStrategyConfig;
  
  if (!history || history.prices.length < 5) {
    return { triggered: false, message: 'Insufficient data', details: null };
  }
  
  // Calculate average volume (last 20 points or all if less)
  const volumes = history.prices.map(p => p.volume);
  const avgVolume = calculateMA(volumes, Math.min(20, volumes.length));
  
  if (avgVolume <= 0 || currentVolume < cfg.minVolumeSpike * avgVolume) {
    return { triggered: false, message: 'No volume spike', details: { currentVolume, avgVolume, ratio: currentVolume / avgVolume } };
  }
  
  // Check if price is also moving up
  if (priceChange < cfg.minPriceChangePercent) {
    return { triggered: false, message: 'Price not moving up enough', details: { priceChange } };
  }
  
  const spikeRatio = currentVolume / avgVolume;
  const message = `🔥 <b>VOLUME SPIKE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Token:</b> ${address.slice(0, 8)}...\n` +
    `<b>Current Volume:</b> $${formatNumber(currentVolume)}\n` +
    `<b>Average Volume:</b> $${formatNumber(avgVolume)}\n` +
    `<b>Spike:</b> ${spikeRatio.toFixed(1)}x\n` +
    `<b>Price Change:</b> ${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%\n\n` +
    `<i>⚠️ High volume + price increase = Potential pump!</i>`;
  
  return { triggered: true, message, details: { currentVolume, avgVolume, spikeRatio, priceChange } };
}

/**
 * Strategy 2: Momentum Back Detection
 * Detect when token bounces back after a pullback
 */
export async function detectMomentumBack(
  address: string,
  currentPrice: number,
  priceChange1h: number,
  priceChange24h: number
): Promise<{ triggered: boolean; message: string; details: any }> {
  const history = tokenHistory.get(address);
  const cfg = defaultStrategyConfig;
  
  if (!history || history.prices.length < 10) {
    return { triggered: false, message: 'Insufficient data', details: null };
  }
  
  const prices = history.prices;
  const currentLow = Math.min(...prices.slice(-10).map(p => p.price));
  const currentHigh = Math.max(...prices.slice(-10).map(p => p.price));
  
  // Calculate pullback from recent high
  const pullbackPercent = ((currentHigh - currentPrice) / currentHigh) * 100;
  
  // Calculate recovery from recent low
  const recoveryPercent = ((currentPrice - currentLow) / currentLow) * 100;
  
  // Check if this is a valid momentum back pattern:
  // 1. Had a pullback (20-40% from high)
  // 2. Now recovering (10%+ from low)
  // 3. Positive 1h or 24h change
  
  if (pullbackPercent < 5 || pullbackPercent > cfg.maxPullbackPercent) {
    return { triggered: false, message: 'No valid pullback pattern', details: { pullbackPercent, recoveryPercent } };
  }
  
  if (recoveryPercent < cfg.minMomentumPercent) {
    return { triggered: false, message: 'Not enough recovery', details: { recoveryPercent } };
  }
  
  if (priceChange1h < 2 && priceChange24h < 5) {
    return { triggered: false, message: 'Price not moving enough', details: { priceChange1h, priceChange24h } };
  }
  
  const message = `📈 <b>MOMENTUM BACK</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Token:</b> ${address.slice(0, 8)}...\n` +
    `<b>Current Price:</b> $${currentPrice}\n` +
    `<b>From ATH:</b> -${pullbackPercent.toFixed(1)}%\n` +
    `<b>Recovery:</b> +${recoveryPercent.toFixed(1)}%\n` +
    `<b>1h Change:</b> ${priceChange1h >= 0 ? '+' : ''}${priceChange1h.toFixed(2)}%\n` +
    `<b>24h Change:</b> ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%\n\n` +
    `<i>🚀 Pattern: Pullback + Recovery = Potential continuation!</i>`;
  
  return { triggered: true, message, details: { pullbackPercent, recoveryPercent, priceChange1h, priceChange24h } };
}

/**
 * Strategy 3: Fresh Token Detection
 * Detect tokens that are newly listed with good metrics
 */
export async function detectFreshToken(
  address: string,
  liquidity: number,
  volume24h: number,
  marketCap: number,
  priceChange24h: number
): Promise<{ triggered: boolean; message: string; details: any }> {
  const history = tokenHistory.get(address);
  
  // Only trigger for tokens we just started tracking (first few data points)
  if (!history || history.prices.length > 5) {
    return { triggered: false, message: 'Not a fresh token', details: null };
  }
  
  // Check minimum requirements
  const minLiquidity = 1000;
  const minVolume = 2000;
  const minMarketCap = 30000;
  
  if (liquidity < minLiquidity) {
    return { triggered: false, message: 'Low liquidity', details: { liquidity } };
  }
  
  if (volume24h < minVolume) {
    return { triggered: false, message: 'Low volume', details: { volume24h } };
  }
  
  if (marketCap < minMarketCap) {
    return { triggered: false, message: 'Low market cap', details: { marketCap } };
  }
  
  // Positive price movement
  if (priceChange24h < 10) {
    return { triggered: false, message: 'Not enough price movement', details: { priceChange24h } };
  }
  
  const message = `🆕 <b>FRESH TOKEN</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `<b>Token:</b> ${address.slice(0, 8)}...\n` +
    `<b>Liquidity:</b> $${formatNumber(liquidity)}\n` +
    `<b>24h Volume:</b> $${formatNumber(volume24h)}\n` +
    `<b>Market Cap:</b> $${formatNumber(marketCap)}\n` +
    `<b>24h Change:</b> ${priceChange24h >= 0 ? '+' : ''}${priceChange24h.toFixed(2)}%\n\n` +
    `<i>🆕 Newly detected with strong metrics!</i>`;
  
  return { triggered: true, message, details: { liquidity, volume24h, marketCap, priceChange24h } };
}

/**
 * Main function to analyze all strategies for a token
 */
export async function analyzeTokenStrategies(
  address: string,
  volume: number,
  liquidity: number,
  marketCap: number,
  price: number,
  priceChange5m: number,
  priceChange1h: number,
  priceChange24h: number,
  pairAddress?: string
): Promise<{ triggered: boolean; messages: string[] }> {
  const messages: string[] = [];
  let triggered = false;
  
  // Update price history (with historical data for new tokens)
  await updateTokenHistory(address, price, volume, pairAddress);
  
  // Save to database
  try {
    updateToken(address, {
      price,
      volume,
      liquidity,
      marketCap
    });
  } catch (error) {
    logger.debug('Database update failed:', error);
  }
  
  // Strategy 1: Volume Spike
  const volumeResult = await detectVolumeSpike(address, volume, price, priceChange1h);
  if (volumeResult.triggered) {
    messages.push(volumeResult.message);
    triggered = true;
    logger.success(`📊 Volume Spike detected for ${address.slice(0, 8)}...`);
    
    // Save alert to database
    addAlert(address, 'VOLUME_SPIKE', volumeResult.details);
  }
  
  // Strategy 2: Momentum Back
  const momentumResult = await detectMomentumBack(address, price, priceChange1h, priceChange24h);
  if (momentumResult.triggered) {
    messages.push(momentumResult.message);
    triggered = true;
    logger.success(`📈 Momentum Back detected for ${address.slice(0, 8)}...`);
    
    // Save alert to database
    addAlert(address, 'MOMENTUM_BACK', momentumResult.details);
  }
  
  // Strategy 3: Fresh Token
  const freshResult = await detectFreshToken(address, liquidity, volume, marketCap, priceChange24h);
  if (freshResult.triggered) {
    messages.push(freshResult.message);
    triggered = true;
    logger.success(`🆕 Fresh Token detected for ${address.slice(0, 8)}...`);
    
    // Save alert to database
    addAlert(address, 'FRESH_TOKEN', freshResult.details);
  }
  
  return { triggered, messages };
}

/**
 * Get strategy statistics
 */
export function getStrategyStats(): any {
  const dbStats = getDatabaseStats();
  
  return {
    trackedTokens: tokenHistory.size,
    strategies: {
      volumeSpike: defaultStrategyConfig.minVolumeSpike + 'x',
      momentumBack: defaultStrategyConfig.minMomentumPercent + '% recovery',
      freshToken: 'Newly tracked tokens',
      useHistoricalData: defaultStrategyConfig.useHistoricalData
    },
    database: dbStats
  };
}

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(2) + 'k';
  return num.toFixed(2);
}
