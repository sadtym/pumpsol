import dotenv from 'dotenv';
dotenv.config();

interface TelegramConfig {
  botToken: string;
  channelId: string;
  sendStartupMessage: boolean;
}

interface ScannerConfig {
  pollInterval: number;
  minLiquidity: number;
  minVolume5m: number;
  minVolume24h: number;
  maxAgeMinutes: number;
  enableMintAuthorityCheck: boolean;
  enableLiquidityLockCheck: boolean;
  enableHolderDistributionCheck: boolean;
  maxHolderConcentration: number;
  bannedWords: string[];
}

interface ApiConfig {
  dexscreener: string;
  birdeye: string;
  solscan: string;
  rpcUrl: string;
  dexscreenerToken?: string;
}

export interface Config {
  telegram: TelegramConfig;
  scanner: ScannerConfig;
  api: ApiConfig;
  enableLogs: boolean;
}

function getEnvString(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return (value || defaultValue) as string;
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.warn(`Invalid number for ${key}, using default: ${defaultValue}`);
    return defaultValue;
  }
  
  return parsed;
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

function getEnvArray(key: string, defaultValue: string[]): string[] {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// Default banned words list
const DEFAULT_BANNED_WORDS = [
  'test', 'fake', 'scam', 'rug', 'honey', 'ponzi', 'dump',
  'sex', 'porn', 'xxx', 'adult', 'nude', 'cock', 'dick', 'pussy',
  'hitler', 'nazi', 'terror', 'bomb', 'kill', 'rape', 'abuse',
  'shit', 'damn', 'fuck', 'ass', 'bitch', 'bastard', 'cunt',
  'whore', 'slut', 'nigger', 'chink', 'spic', 'kike', 'faggot'
];

export const config: Config = {
  telegram: {
    botToken: getEnvString('TELEGRAM_BOT_TOKEN'),
    channelId: getEnvString('TELEGRAM_CHANNEL_ID'),
    sendStartupMessage: process.env.SEND_STARTUP_MESSAGE === 'true'
  },
  
  scanner: {
    pollInterval: getEnvNumber('POLL_INTERVAL', 3000),
    minLiquidity: getEnvNumber('MIN_LIQUIDITY', 300),
    minVolume5m: getEnvNumber('MIN_VOLUME', 100),
    minVolume24h: getEnvNumber('MIN_VOLUME_24H', 1000),
    maxAgeMinutes: getEnvNumber('MAX_AGE', 10),
    enableMintAuthorityCheck: getEnvBoolean('CHECK_MINT_AUTHORITY', false),
    enableLiquidityLockCheck: getEnvBoolean('CHECK_LIQUIDITY_LOCK', false),
    enableHolderDistributionCheck: getEnvBoolean('CHECK_HOLDER_DISTRIBUTION', false),
    maxHolderConcentration: getEnvNumber('MAX_HOLDER_CONCENTRATION', 20),
    bannedWords: getEnvArray('BANNED_WORDS', DEFAULT_BANNED_WORDS)
  },
  
  api: {
    dexscreener: 'https://api.dexscreener.com/latest/dex',
    birdeye: 'https://public-api.birdeye.so/public',
    solscan: 'https://api.solscan.io',
    rpcUrl: getEnvString('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
    dexscreenerToken: process.env.DEXSCREENER_API_TOKEN
  },
  
  enableLogs: process.env.ENABLE_LOGS !== 'false'
};

if (!config.telegram.botToken || !config.telegram.channelId) {
  console.error('ERROR: Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHANNEL_ID in .env');
  process.exit(1);
}

console.log('[CONFIG] Configuration loaded successfully');
console.log(`[CONFIG] Poll interval: ${config.scanner.pollInterval}ms`);
console.log(`[CONFIG] Min liquidity: $${config.scanner.minLiquidity}`);
console.log(`[CONFIG] Min volume 24h: $${config.scanner.minVolume24h}`);
console.log(`[CONFIG] Mint authority check: ${config.scanner.enableMintAuthorityCheck}`);
console.log(`[CONFIG] Liquidity lock check: ${config.scanner.enableLiquidityLockCheck}`);
console.log(`[CONFIG] Holder distribution check: ${config.scanner.enableHolderDistributionCheck}`);
console.log(`[CONFIG] Banned words: ${config.scanner.bannedWords.length} words`);
