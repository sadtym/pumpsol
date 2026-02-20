import { fetchWithRetry } from '../utils/fetch.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

// DexScreener API v1 endpoints
const DEX_BASE_URL = 'https://api.dexscreener.com';

// Token Boost interfaces
export interface BoostToken {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: {
    type?: string;
    label?: string;
    url: string;
  }[];
  marketCap?: number;
  liquidity?: number;
  fdv?: number;
  priceChange?: {
    m5: number;
    h1: number;
    h24: number;
  };
  price?: string;
  boosts?: {
    active: number;
    rank: number;
  };
}

// Community Takeover interfaces
export interface CommunityTakeover {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
  links?: {
    type?: string;
    label?: string;
    url: string;
  }[];
  claimDate?: string;
}

// API Response types
export interface LatestBoostsResponse extends Array<BoostToken> {}
export interface TopBoostsResponse extends Array<BoostToken> {}
export interface CommunityTakeoversResponse extends Array<CommunityTakeover> {}

// Fetch latest token boosts
export async function fetchLatestBoosts(): Promise<BoostToken[]> {
  try {
    const url = `${DEX_BASE_URL}/token-boosts/latest/v1`;
    logger.debug(`Fetching latest boosts from: ${url}`);
    
    const data = await fetchWithRetry<LatestBoostsResponse>(url, {
      timeout: 10000,
      retries: 3
    });
    
    if (data && Array.isArray(data)) {
      logger.info(`Fetched ${data.length} latest boosted tokens`);
      return data;
    }
    
    return [];
  } catch (error) {
    logger.error('Failed to fetch latest boosts:', error);
    return [];
  }
}

// Fetch top token boosts
export async function fetchTopBoosts(): Promise<BoostToken[]> {
  try {
    const url = `${DEX_BASE_URL}/token-boosts/top/v1`;
    logger.debug(`Fetching top boosts from: ${url}`);
    
    const data = await fetchWithRetry<TopBoostsResponse>(url, {
      timeout: 10000,
      retries: 3
    });
    
    if (data && Array.isArray(data)) {
      logger.info(`Fetched ${data.length} top boosted tokens`);
      return data;
    }
    
    return [];
  } catch (error) {
    logger.error('Failed to fetch top boosts:', error);
    return [];
  }
}

// Fetch community takeovers
export async function fetchCommunityTakeovers(): Promise<CommunityTakeover[]> {
  try {
    const url = `${DEX_BASE_URL}/community-takeovers/latest/v1`;
    logger.debug(`Fetching community takeovers from: ${url}`);
    
    const data = await fetchWithRetry<CommunityTakeoversResponse>(url, {
      timeout: 10000,
      retries: 3
    });
    
    if (data && Array.isArray(data)) {
      logger.info(`Fetched ${data.length} community takeovers`);
      return data;
    }
    
    return [];
  } catch (error) {
    logger.error('Failed to fetch community takeovers:', error);
    return [];
  }
}

// Get pair data for a specific token
export async function getTokenPairData(chainId: string, tokenAddress: string): Promise<any> {
  try {
    const url = `${DEX_BASE_URL}/latest/dex/pairs/${chainId}/${tokenAddress}`;
    logger.debug(`Fetching pair data from: ${url}`);
    
    const data = await fetchWithRetry<any>(url, {
      timeout: 8000,
      retries: 2
    });
    
    return data;
  } catch (error) {
    logger.error(`Failed to fetch pair data for ${tokenAddress}:`, error);
    return null;
  }
}

// Fetch token profile (full info)
export async function getTokenProfile(chainId: string, tokenAddress: string): Promise<BoostToken | null> {
  try {
    const url = `${DEX_BASE_URL}/token-profiles/latest/v1?chainId=${chainId}&tokenAddress=${tokenAddress}`;
    logger.debug(`Fetching token profile from: ${url}`);
    
    const data = await fetchWithRetry<BoostToken>(url, {
      timeout: 8000,
      retries: 2
    });
    
    return data;
  } catch (error) {
    logger.error(`Failed to fetch token profile for ${tokenAddress}:`, error);
    return null;
  }
}

// Helper to filter by chain
export function filterByChain(tokens: BoostToken[], chainId: string): BoostToken[] {
  return tokens.filter(token => token.chainId?.toLowerCase() === chainId.toLowerCase());
}

// Helper to filter by chain for takeovers
export function filterTakeoversByChain(takeovers: CommunityTakeover[], chainId: string): CommunityTakeover[] {
  return takeovers.filter(takeover => takeover.chainId?.toLowerCase() === chainId.toLowerCase());
}

// Get unique chains from tokens
export function getUniqueChains(tokens: BoostToken[]): string[] {
  const chains = new Set<string>();
  tokens.forEach(token => {
    if (token.chainId) {
      chains.add(token.chainId);
    }
  });
  return Array.from(chains);
}

// Historical candle data
export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Fetch token price history (candles)
export async function fetchTokenHistory(
  chainId: string, 
  pairAddress: string, 
  timeframe: '1m' | '5m' | '15m' | '1h' | '4h' = '1h',
  limit: number = 100
): Promise<CandleData[]> {
  try {
    const url = `${DEX_BASE_URL}/prices/history/${chainId}/${pairAddress}?from=${timeframe}&limit=${limit}`;
    logger.debug(`Fetching token history from: ${url}`);
    
    const response = await fetchWithRetry<{ tokenAddress: string; pairAddress: string; candles: CandleData[] }>(url, {
      timeout: 10000,
      retries: 2
    });
    
    if (response?.candles && Array.isArray(response.candles)) {
      logger.info(`Fetched ${response.candles.length} candles for ${pairAddress}`);
      return response.candles;
    }
    
    return [];
  } catch (error) {
    logger.error(`Failed to fetch history for ${pairAddress}:`, error);
    return [];
  }
}
