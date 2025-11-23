import { logger } from '../utils/logger.js';
import { TokenPair } from './scanner.js';

const RUGCHECK_API = 'https://api.rugcheck.xyz/v1/tokens';

interface RugCheckReport {
  score: number;
  risks: {
    name: string;
    value: string;
    level: string;
    score: number;
  }[];
  tokenProgram: string;
  tokenType: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export async function checkRugStatus(pair: TokenPair): Promise<boolean> {
  const mint = pair.baseToken.address;
  
  try {
    const url = `${RUGCHECK_API}/${mint}/report/summary`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        logger.debug(`RugCheck report not found for ${pair.baseToken.symbol} (Too new)`);
        return true;
      }
      return true;
    }

    const data = await response.json() as any;
    
    const score = data.score || 0;
    
    if (score > 1500) {
      logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: High RugCheck Score (${score})`);
      return false;
    }
    
    const risks = data.risks || [];
    const criticalRisks = risks.filter((r: any) => r.level === 'danger');
    
    if (criticalRisks.length > 0) {
      const riskNames = criticalRisks.map((r: any) => r.name).join(', ');
      logger.warn(`❌ ${pair.baseToken.symbol} REJECTED: Critical Risks (${riskNames})`);
      return false;
    }

    logger.debug(`✅ ${pair.baseToken.symbol}: RugCheck Passed (Score: ${score})`);
    return true;

  } catch (error) {
    logger.warn(`RugCheck API failed for ${pair.baseToken.symbol}, skipping check...`);
    return true;
  }
}
