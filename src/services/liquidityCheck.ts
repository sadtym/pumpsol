import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { TokenPair } from './scanner.js';

const BURN_ADDRESSES = [
  '11111111111111111111111111111111',
  'Dead111111111111111111111111111111111111111',
];

const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

export async function isLiquidityLocked(pair: TokenPair): Promise<boolean> {
  try {
    const dexId = pair.dexId || '';
    
    if (dexId === 'pumpfun' || dexId === 'moonshot') {
      logger.debug(`✅ ${pair.baseToken.symbol}: Locked (Pump.fun/Moonshot mechanism)`);
      return true;
    }

    return false; 

  } catch (error) {
    logger.warn(`Failed to check LP lock for ${pair.baseToken.symbol}:`, error);
    return false;
  }
}

async function rpcCall(method: string, params: any[]): Promise<any> {
  try {
    const response = await fetch(config.api.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params
      })
    });
    
    const json = await response.json() as any;
    return json.result;
  } catch (error) {
    return null;
  }
}
