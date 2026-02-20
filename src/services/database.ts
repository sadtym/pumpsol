import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

// Database file path
const DB_PATH = process.env.DB_PATH || './data';

// Ensure data directory exists
function ensureDir(): void {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(DB_PATH, { recursive: true });
  }
}

// Token record interface
export interface TokenRecord {
  address: string;
  symbol: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  priceHistory: number[];
  volumeHistory: number[];
  liquidityHistory: number[];
  marketCapHistory: number[];
  alerts: string[];
  maxPrice: number;
  minPrice: number;
  totalVolume: number;
}

// Token alerts interface
export interface TokenAlert {
  id: string;
  tokenAddress: string;
  type: string;
  timestamp: number;
  details: any;
}

// Database interfaces
interface TokenDatabase {
  tokens: Record<string, TokenRecord>;
  alerts: TokenAlert[];
  lastUpdate: number;
}

// In-memory cache
let database: TokenDatabase = {
  tokens: {},
  alerts: [],
  lastUpdate: Date.now()
};

/**
 * Load database from file
 */
export function loadDatabase(): void {
  try {
    ensureDir();
    const dbFile = path.join(DB_PATH, 'tokens.json');
    
    if (fs.existsSync(dbFile)) {
      const data = fs.readFileSync(dbFile, 'utf-8');
      database = JSON.parse(data);
      logger.info(`📂 Database loaded: ${Object.keys(database.tokens).length} tokens`);
    } else {
      logger.info('📂 New database created');
      saveDatabase();
    }
  } catch (error) {
    logger.error('Failed to load database:', error);
    database = { tokens: {}, alerts: [], lastUpdate: Date.now() };
  }
}

/**
 * Save database to file
 */
export function saveDatabase(): void {
  try {
    ensureDir();
    const dbFile = path.join(DB_PATH, 'tokens.json');
    database.lastUpdate = Date.now();
    fs.writeFileSync(dbFile, JSON.stringify(database, null, 2));
    logger.debug('💾 Database saved');
  } catch (error) {
    logger.error('Failed to save database:', error);
  }
}

/**
 * Add or update a token in the database
 */
export function updateToken(
  address: string,
  data: {
    symbol?: string;
    name?: string;
    price?: number;
    volume?: number;
    liquidity?: number;
    marketCap?: number;
  }
): TokenRecord {
  const now = Date.now();
  
  if (!database.tokens[address]) {
    // New token
    database.tokens[address] = {
      address,
      symbol: data.symbol || 'UNKNOWN',
      name: data.name || 'Unknown Token',
      firstSeen: now,
      lastSeen: now,
      priceHistory: [],
      volumeHistory: [],
      liquidityHistory: [],
      marketCapHistory: [],
      alerts: [],
      maxPrice: data.price || 0,
      minPrice: data.price || 0,
      totalVolume: 0
    };
  }
  
  const token = database.tokens[address];
  token.lastSeen = now;
  
  // Update price history (keep last 100)
  if (data.price !== undefined) {
    token.priceHistory.push(data.price);
    if (token.priceHistory.length > 100) {
      token.priceHistory = token.priceHistory.slice(-100);
    }
    if (data.price > token.maxPrice) token.maxPrice = data.price;
    if (data.price < token.minPrice || token.minPrice === 0) token.minPrice = data.price;
  }
  
  // Update volume history
  if (data.volume !== undefined) {
    token.volumeHistory.push(data.volume);
    if (token.volumeHistory.length > 100) {
      token.volumeHistory = token.volumeHistory.slice(-100);
    }
    token.totalVolume += data.volume;
  }
  
  // Update liquidity history
  if (data.liquidity !== undefined) {
    token.liquidityHistory.push(data.liquidity);
    if (token.liquidityHistory.length > 100) {
      token.liquidityHistory = token.liquidityHistory.slice(-100);
    }
  }
  
  // Update market cap history
  if (data.marketCap !== undefined) {
    token.marketCapHistory.push(data.marketCap);
    if (token.marketCapHistory.length > 100) {
      token.marketCapHistory = token.marketCapHistory.slice(-100);
    }
  }
  
  // Update metadata
  if (data.symbol) token.symbol = data.symbol;
  if (data.name) token.name = data.name;
  
  // Auto-save every 10 updates
  if (Object.keys(database.tokens).length % 10 === 0) {
    saveDatabase();
  }
  
  return token;
}

/**
 * Add an alert to the database
 */
export function addAlert(
  tokenAddress: string,
  alertType: string,
  details: any
): void {
  const alert: TokenAlert = {
    id: `${tokenAddress}-${Date.now()}`,
    tokenAddress,
    type: alertType,
    timestamp: Date.now(),
    details
  };
  
  database.alerts.push(alert);
  
  // Keep last 1000 alerts
  if (database.alerts.length > 1000) {
    database.alerts = database.alerts.slice(-1000);
  }
  
  // Update token's alert list
  if (database.tokens[tokenAddress]) {
    database.tokens[tokenAddress].alerts.push(`${alertType} at ${new Date().toISOString()}`);
    if (database.tokens[tokenAddress].alerts.length > 50) {
      database.tokens[tokenAddress].alerts = database.tokens[tokenAddress].alerts.slice(-50);
    }
  }
  
  saveDatabase();
}

/**
 * Get token by address
 */
export function getToken(address: string): TokenRecord | null {
  return database.tokens[address] || null;
}

/**
 * Get all tokens sorted by last seen
 */
export function getAllTokens(limit: number = 100): TokenRecord[] {
  return Object.values(database.tokens)
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit);
}

/**
 * Get tokens by performance
 */
export function getTopPerformers(limit: number = 10): TokenRecord[] {
  return Object.values(database.tokens)
    .filter(t => t.priceHistory.length > 0)
    .map(t => ({
      ...t,
      priceChange: t.priceHistory.length > 1 
        ? ((t.priceHistory[t.priceHistory.length - 1] - t.priceHistory[0]) / t.priceHistory[0]) * 100 
        : 0
    }))
    .sort((a, b) => b.priceChange - a.priceChange)
    .slice(0, limit);
}

/**
 * Get recent alerts
 */
export function getRecentAlerts(limit: number = 20): TokenAlert[] {
  return database.alerts
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * Get database statistics
 */
export function getDatabaseStats(): any {
  const tokens = Object.values(database.tokens);
  
  return {
    totalTokens: tokens.length,
    totalAlerts: database.alerts.length,
    lastUpdate: new Date(database.lastUpdate).toISOString(),
    topPerformers: getTopPerformers(5).map(t => ({
      symbol: t.symbol,
      address: t.address.slice(0, 8) + '...',
      priceChange: t.priceHistory.length > 1 
        ? ((t.priceHistory[t.priceHistory.length - 1] - t.priceHistory[0]) / t.priceHistory[0] * 100).toFixed(2) + '%'
        : 'N/A',
      totalVolume: t.totalVolume
    }))
  };
}

/**
 * Cleanup old tokens (not seen in 24 hours)
 */
export function cleanupOldTokens(): number {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let cleaned = 0;
  
  for (const address in database.tokens) {
    if (database.tokens[address].lastSeen < oneDayAgo) {
      delete database.tokens[address];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.info(`🧹 Cleaned up ${cleaned} old tokens from database`);
    saveDatabase();
  }
  
  return cleaned;
}

// Auto-cleanup every hour
setInterval(cleanupOldTokens, 60 * 60 * 1000);
