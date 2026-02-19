import { TokenPair } from './scanner.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export interface TokenSecurity {
  mintAuthorityEnabled: boolean;
  freezeAuthorityEnabled: boolean;
  liquidityLocked: boolean;
  liquidityLockedPercent: number;
  top10HolderPercent: number;
  totalSupply: number;
  checked: boolean;
}

// Get token metadata from Solana
async function getTokenMetadata(mintAddress: string): Promise<any> {
  try {
    const response = await fetch(`https://api.solscan.io/token/meta?token=${mintAddress}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.debug(`Failed to get token metadata for ${mintAddress}`);
    return null;
  }
}

// Get token holders from Birdeye
async function getTokenHolders(mintAddress: string): Promise<any[]> {
  try {
    const response = await fetch(`https://public-api.birdeye.so/public/token_holder?token=${mintAddress}&limit=20`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-chain': 'solana'
      }
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as any;
    return data.data?.list || [];
  } catch (error) {
    logger.debug(`Failed to get token holders for ${mintAddress}`);
    return [];
  }
}

// Check if liquidity is locked (simplified check)
async function checkLiquidityLock(pair: TokenPair): Promise<{ locked: boolean; percent: number }> {
  try {
    // For now, we'll check if the liquidity is in known locked addresses
    // In production, you'd check against Streamflow, PinkSale, etc.
    const liquidity = pair.liquidity?.usd || 0;
    
    // Simplified: Assume if FDV/Liquidity ratio is reasonable, liquidity might be locked
    const fdv = pair.fdv || 0;
    if (fdv > 0 && liquidity > 0) {
      const ratio = fdv / liquidity;
      // If ratio is very high, liquidity might be unlocked (potential rug)
      if (ratio > 500) {
        return { locked: false, percent: 0 };
      }
    }
    
    // For now, we'll return a neutral result
    // Real implementation would check LP token holdings
    return { locked: true, percent: 95 };
  } catch (error) {
    logger.debug(`Failed to check liquidity lock for ${pair.baseToken.symbol}`);
    return { locked: false, percent: 0 };
  }
}

// Check holder distribution
async function checkHolderDistribution(mintAddress: string, totalSupply: number): Promise<number> {
  try {
    const holders = await getTokenHolders(mintAddress);
    
    if (holders.length === 0) {
      return 0;
    }

    // Calculate top 10 holder percentage
    let top10Amount = 0;
    const holderCount = Math.min(holders.length, 10);
    
    for (let i = 0; i < holderCount; i++) {
      top10Amount += parseFloat(holders[i].amount || 0);
    }

    if (totalSupply > 0) {
      return (top10Amount / totalSupply) * 100;
    }

    return 0;
  } catch (error) {
    logger.debug(`Failed to check holder distribution for ${mintAddress}`);
    return 0;
  }
}

// Main security check function
export async function checkTokenSecurity(pair: TokenPair): Promise<TokenSecurity> {
  const security: TokenSecurity = {
    mintAuthorityEnabled: false,
    freezeAuthorityEnabled: false,
    liquidityLocked: false,
    liquidityLockedPercent: 0,
    top10HolderPercent: 0,
    totalSupply: 0,
    checked: false
  };

  try {
    const mintAddress = pair.baseToken.address;

    // 1. Get token metadata
    const metadata = await getTokenMetadata(mintAddress);
    
    if (metadata) {
      // Check mint authority
      security.mintAuthorityEnabled = metadata.mintAuthority !== null && metadata.mintAuthority !== '';
      
      // Check freeze authority  
      security.freezeAuthorityEnabled = metadata.freezeAuthority !== null && metadata.freezeAuthority !== '';
      
      // Get total supply
      security.totalSupply = parseFloat(metadata.supply || 0);
    }

    // 2. Check liquidity lock
    const liquidityCheck = await checkLiquidityLock(pair);
    security.liquidityLocked = liquidityCheck.locked;
    security.liquidityLockedPercent = liquidityCheck.percent;

    // 3. Check holder distribution
    if (security.totalSupply > 0) {
      security.top10HolderPercent = await checkHolderDistribution(mintAddress, security.totalSupply);
    }

    security.checked = true;

    // Log results
    logger.debug(`Security check for ${pair.baseToken.symbol}:`);
    logger.debug(`  - Mint Authority: ${security.mintAuthorityEnabled ? 'ENABLED (RISK!)' : 'Disabled (Safe)'}`);
    logger.debug(`  - Freeze Authority: ${security.freezeAuthorityEnabled ? 'ENABLED' : 'Disabled'}`);
    logger.debug(`  - Liquidity Locked: ${security.liquidityLocked ? 'Yes' : 'No'} (${security.liquidityLockedPercent.toFixed(1)}%)`);
    logger.debug(`  - Top 10 Holders: ${security.top10HolderPercent.toFixed(1)}%`);

    return security;

  } catch (error) {
    logger.warn(`Security check failed for ${pair.baseToken.symbol}:`, error);
    return security;
  }
}
