import { TokenPair } from './scanner.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { checkTokenSecurity, TokenSecurity } from './tokenSecurity.js';

export interface FilterResult {
  passed: boolean;
  reason?: string;
  warnings: string[];
  security: TokenSecurity | null;
  stats: {
    liquidity: number;
    volume5m: number;
    volume24h: number;
    priceChange: number;
  };
}

export function filterToken(pair: TokenPair): FilterResult {
  const warnings: string[] = [];
  const symbol = pair.baseToken.symbol.toLowerCase();
  const name = pair.baseToken.name.toLowerCase();

  const liquidity = pair.liquidity?.usd || 0;
  const volume5m = pair.volume?.m5 || 0;
  const volume24h = pair.volume?.h24 || 0;
  const priceChange = pair.priceChange?.m5 || 0;

  const stats = { liquidity, volume5m, volume24h, priceChange };

  logger.info(`🔍 Filtering: ${pair.baseToken.symbol}`);
  logger.info(`   Liquidity: ${formatCurrency(liquidity)}`);
  logger.info(`   Volume 5m: ${formatCurrency(volume5m)}`);
  logger.info(`   Volume 24h: ${formatCurrency(volume24h)}`);

  // 1. Banned Words Filter
  const bannedCheck = checkBannedWords(pair.baseToken.symbol, pair.baseToken.name);
  if (bannedCheck.banned) {
    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Banned word found (${bannedCheck.matches.join(', ')})`);
    return {
      passed: false,
      reason: `Banned word detected: ${bannedCheck.matches.join(', ')}`,
      warnings,
      security: null,
      stats
    };
  }

  // 2. Liquidity Filter
  if (liquidity < config.scanner.minLiquidity) {
    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Low liquidity ($${liquidity.toFixed(0)} < $${config.scanner.minLiquidity})`);
    return {
      passed: false,
      reason: `Low liquidity: ${formatCurrency(liquidity)}`,
      warnings,
      security: null,
      stats
    };
  }

  // 3. Volume 5m Filter
  if (volume5m < config.scanner.minVolume5m) {
    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Low volume 5m ($${volume5m.toFixed(0)} < $${config.scanner.minVolume5m})`);
    return {
      passed: false,
      reason: `Low volume 5m: ${formatCurrency(volume5m)}`,
      warnings,
      security: null,
      stats
    };
  }

  // 4. Volume 24h Filter (for older tokens)
  if (volume24h < config.scanner.minVolume24h && pair.pairCreatedAt) {
    const ageMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
    if (ageMinutes > 60) { // Only apply for tokens older than 1 hour
      logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Low volume 24h ($${volume24h.toFixed(0)} < $${config.scanner.minVolume24h})`);
      return {
        passed: false,
        reason: `Low volume 24h: ${formatCurrency(volume24h)}`,
        warnings,
        security: null,
        stats
      };
    }
  }

  // 5. FDV/Liquidity Ratio
  const fdv = pair.fdv || 0;
  if (fdv > 0 && liquidity > 0) {
    const ratio = fdv / liquidity;
    if (ratio > 1000) {
      logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Suspicious FDV/Liquidity ratio (${ratio.toFixed(0)}x)`);
      return {
        passed: false,
        reason: `Suspicious FDV/Liquidity ratio (Potential Scam)`,
        warnings,
        security: null,
        stats
      };
    }
    if (ratio > 100) {
      warnings.push(`⚠️ High FDV/Liquidity ratio: ${ratio.toFixed(0)}x`);
    }
  }

  // 6. Honeypot Pattern Detection
  if (priceChange > 300 && volume5m < 1000) {
    logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Honeypot pattern (High pump, low volume)`);
    return {
      passed: false,
      reason: `Honeypot pattern detected`,
      warnings,
      security: null,
      stats
    };
  }

  // 7. Price Change Warnings
  if (priceChange > 300) {
    warnings.push(`⚠️ Extreme pump: +${priceChange.toFixed(0)}%`);
    logger.warn(`⚠️ ${pair.baseToken.symbol}: Extreme pump detected (+${priceChange.toFixed(0)}%)`);
  } else if (priceChange > 100) {
    warnings.push(`⚠️ High pump: +${priceChange.toFixed(0)}%`);
  }

  // 8. Age Warnings
  if (pair.pairCreatedAt) {
    const ageMinutes = (Date.now() - pair.pairCreatedAt) / 60000;
    if (ageMinutes < 2) {
      warnings.push('⚠️ Very new (<2m)');
      logger.warn(`⚠️ ${pair.baseToken.symbol}: Very new token (${ageMinutes.toFixed(1)}m)`);
    }
  }

  // 9. Low Liquidity Warning
  if (liquidity < 1000) {
    warnings.push('⚠️ Low liquidity');
  }

  // 10. Low Volume Warnings
  if (volume5m < 200) {
    warnings.push('⚠️ Low volume 5m');
  }
  if (volume24h < 5000) {
    warnings.push('⚠️ Low volume 24h');
  }

  logger.success(`✅ ${pair.baseToken.symbol} PASSED basic filters!`);
  
  if (warnings.length > 0) {
    logger.warn(`⚠️ ${pair.baseToken.symbol} has ${warnings.length} warning(s)`);
  }

  return {
    passed: true,
    warnings,
    security: null,
    stats
  };
}

// Check for banned words
function checkBannedWords(symbol: string, name: string): { banned: boolean; matches: string[] } {
  const bannedWords = config.scanner.bannedWords;
  const symbolLower = symbol.toLowerCase();
  const nameLower = name.toLowerCase();
  
  const matches: string[] = [];
  
  for (const word of bannedWords) {
    if (symbolLower.includes(word) || nameLower.includes(word)) {
      matches.push(word);
    }
  }
  
  return {
    banned: matches.length > 0,
    matches
  };
}

// Extended filter with security checks
export async function filterTokenWithSecurity(pair: TokenPair): Promise<FilterResult> {
  const result = filterToken(pair);
  
  if (!result.passed) {
    return result;
  }

  // Perform security checks if enabled
  if (config.scanner.enableMintAuthorityCheck || config.scanner.enableLiquidityLockCheck || config.scanner.enableHolderDistributionCheck) {
    try {
      logger.info(`🔐 Performing security checks for ${pair.baseToken.symbol}...`);
      const security = await checkTokenSecurity(pair);
      result.security = security;

      // Check Mint Authority
      if (config.scanner.enableMintAuthorityCheck && security.mintAuthorityEnabled) {
        logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Mint authority enabled`);
        return {
          passed: false,
          reason: 'Mint authority is enabled (can mint more tokens)',
          warnings: result.warnings,
          security,
          stats: result.stats
        };
      }

      // Check Liquidity Lock
      if (config.scanner.enableLiquidityLockCheck && !security.liquidityLocked) {
        result.warnings.push('⚠️ Liquidity NOT locked');
        logger.warn(`⚠️ ${pair.baseToken.symbol}: Liquidity is NOT locked`);
      }

      // Check Holder Distribution
      if (config.scanner.enableHolderDistributionCheck && security.top10HolderPercent > config.scanner.maxHolderConcentration) {
        logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: High holder concentration (${security.top10HolderPercent.toFixed(1)}%)`);
        return {
          passed: false,
          reason: `High holder concentration: ${security.top10HolderPercent.toFixed(1)}%`,
          warnings: result.warnings,
          security,
          stats: result.stats
        };
      }

      if (security.top10HolderPercent > 20) {
        result.warnings.push(`⚠️ High holder concentration: ${security.top10HolderPercent.toFixed(1)}%`);
      }

      logger.success(`✅ ${pair.baseToken.symbol} PASSED security checks!`);
      
    } catch (error) {
      logger.warn(`⚠️ Security check failed for ${pair.baseToken.symbol}, continuing...`);
    }
  }

  return result;
}

export function formatCurrency(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${value.toFixed(0)}`;
}
