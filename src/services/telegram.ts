import { Telegraf } from 'telegraf';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { TokenPair } from './scanner.js';
import { FilterResult, formatCurrency } from './filter.js';
import { formatAge, getAgeMinutes } from './scanner.js';

let bot: Telegraf;
let isReady = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const MESSAGE_RATE_LIMIT = 1000;
let lastMessageTime = 0;

async function rateLimitWait(): Promise<void> {
  const now = Date.now();
  const timeSinceLastMessage = now - lastMessageTime;
  
  if (timeSinceLastMessage < MESSAGE_RATE_LIMIT) {
    const waitTime = MESSAGE_RATE_LIMIT - timeSinceLastMessage;
    logger.info(`[RATE LIMIT] Waiting ${waitTime}ms...`);
    await new Promise(r => setTimeout(r, waitTime));
  }
  
  lastMessageTime = Date.now();
}

function splitMessage(message: string): string[] {
  const MAX_LENGTH = 4000;
  
  if (message.length <= MAX_LENGTH) {
    return [message];
  }
  
  const parts: string[] = [];
  let currentPart = '';
  
  const lines = message.split('\n');
  
  for (const line of lines) {
    if ((currentPart + line + '\n').length > MAX_LENGTH) {
      if (currentPart) {
        parts.push(currentPart.trim());
        currentPart = '';
      }
    }
    currentPart += line + '\n';
  }
  
  if (currentPart) {
    parts.push(currentPart.trim());
  }
  
  return parts;
}

async function sendWithRetry(
  message: string,
  attempt = 1
): Promise<boolean> {
  try {
    await bot.telegram.sendMessage(config.telegram.channelId, message, {
      parse_mode: 'HTML',
      link_preview_options: {
        is_disabled: true
      }
    });
    
    return true;
    
  } catch (error: any) {
    if (attempt >= 3) {
      logger.error(`[TELEGRAM] Failed after 3 attempts:`, error.message);
      return false;
    }
    
    logger.warn(`[TELEGRAM] Retry ${attempt}/3...`);
    
    await new Promise(r => setTimeout(r, 1000 * attempt));
    
    return sendWithRetry(message, attempt + 1);
  }
}

export async function initBot(): Promise<boolean> {
  try {
    bot = new Telegraf(config.telegram.botToken);

    bot.catch((err: any) => {
      logger.error('Telegram bot error (caught):', err.message);
      
      if (err.code === 'EFATAL' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        logger.warn('Network error detected, will retry...');
      }
    });

    let connected = false;
    for (let i = 0; i < 3; i++) {
      try {
        const me = await bot.telegram.getMe();
        logger.success(`✅ Bot connected: @${me.username}`);
        connected = true;
        break;
      } catch (error: any) {
        logger.warn(`Connection attempt ${i + 1}/3 failed, retrying...`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!connected) {
      throw new Error('Failed to connect after 3 attempts');
    }
    
    isReady = true;
    reconnectAttempts = 0;
    return true;

  } catch (error: any) {
    logger.error('Failed to initialize bot:', error.message);
    return false;
  }
}

export async function sendAlert(
  pair: TokenPair,
  filterResult: FilterResult
): Promise<boolean> {
  if (!isReady) {
    logger.warn('Bot not ready, attempting to reconnect...');
    const reconnected = await initBot();
    if (!reconnected) {
      logger.error('Failed to reconnect, skipping alert');
      return false;
    }
  }

  try {
    const message = formatMessage(pair, filterResult);
    const parts = splitMessage(message);
    
    logger.info(`[TELEGRAM] Sending ${parts.length} message part(s)...`);
    
    for (let i = 0; i < parts.length; i++) {
      await rateLimitWait();
      
      const sent = await sendWithRetry(parts[i]);
      
      if (!sent) {
        logger.error(`Failed to send part ${i + 1}/${parts.length}`);
        return false;
      }
      
      logger.info(`Sent part ${i + 1}/${parts.length}`);
    }
    
    logger.success(`📤 Alert sent: ${pair.baseToken.symbol}`);
    reconnectAttempts = 0;
    return true;

  } catch (error: any) {
    logger.error('Error sending alert:', error.message);
    
    if (error.code === 'EFATAL' || error.code === 'ECONNRESET') {
      logger.warn('Network error, attempting reconnect...');
      
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        isReady = false;
        await new Promise(r => setTimeout(r, 3000));
        await initBot();
      } else {
        logger.error('Max reconnect attempts reached');
      }
    }
    
    return false;
  }
}

function formatMessage(pair: TokenPair, filterResult: FilterResult): string {
  const symbol = pair.baseToken.symbol;
  const name = pair.baseToken.name;
  const age = pair.pairCreatedAt ? formatAge(getAgeMinutes(pair.pairCreatedAt)) : 'Unknown';
  const liquidity = formatCurrency(filterResult.stats.liquidity);
  const volume5m = formatCurrency(filterResult.stats.volume5m);
  const volume24h = formatCurrency(pair.volume?.h24 || 0);
  const priceChange = filterResult.stats.priceChange;
  const price = pair.priceUsd || '0';

  let msg = `🔥 <b>NEW MEME COIN DETECTED</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `<b>Token:</b> $${symbol}\n`;
  msg += `<b>Name:</b> ${name}\n`;
  msg += `<b>Age:</b> ${age} ⚡\n`;
  msg += `<b>LP Locked:</b> ✅ YES\n\n`;

  msg += `<b>💰 Trading Stats:</b>\n`;
  msg += `Price: $${price}\n`;
  msg += `Liquidity: ${liquidity}\n`;
  msg += `Volume 5m: ${volume5m}\n`;
  msg += `Volume 24h: ${volume24h}\n`;
  
  if (priceChange !== 0) {
    const sign = priceChange > 0 ? '+' : '';
    const emoji = priceChange > 50 ? '🚀' : priceChange > 0 ? '📈' : '📉';
    msg += `Change 5m: ${emoji} ${sign}${priceChange.toFixed(1)}%\n`;
  }

  if (filterResult.warnings.length > 0) {
    msg += `\n<b>⚠️ Risk Warnings:</b>\n`;
    filterResult.warnings.forEach(w => {
      msg += `${w}\n`;
    });
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `<b>📊 Contract Address:</b>\n`;
  msg += `<code>${pair.baseToken.address}</code>\n\n`;
  msg += `🔗 <a href="${pair.url}">📈 View Chart</a> | <a href="https://solscan.io/token/${pair.baseToken.address}">📋 Solscan</a>\n\n`;
  msg += `<i>⚠️ DYOR: High risk investment. Not financial advice.</i>`;

  return msg;
}

export async function sendStartup(): Promise<void> {
  if (!isReady) return;
  
  if (!config.telegram.sendStartupMessage) {
    logger.info('Startup message disabled (SEND_STARTUP_MESSAGE=false)');
    return;
  }

  try {
    const msg = `🤖 <b>Meme Coin Scanner v3.0 Started</b>\n\n` +
                `✅ Production mode active\n` +
                `✅ All protections enabled\n\n` +
                `<b>Filter Settings:</b>\n` +
                `Min Liquidity: ${formatCurrency(config.scanner.minLiquidity)}\n` +
                `Min Volume (5m): ${formatCurrency(config.scanner.minVolume5m)}\n` +
                `Max Age: ${config.scanner.maxAgeMinutes} minutes\n\n` +
                `Waiting for new tokens...`;

    await sendWithRetry(msg);
    logger.info('Startup message sent');
  } catch (error: any) {
    logger.warn('Could not send startup message:', error.message);
  }
}

export async function sendErrorNotification(errorMsg: string): Promise<void> {
  if (!isReady) return;

  try {
    const msg = `⚠️ <b>Scanner Error</b>\n\n${errorMsg}\n\n<i>Scanner continues running...</i>`;
    await sendWithRetry(msg);
  } catch {
    
  }
}
