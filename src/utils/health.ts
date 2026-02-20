import http from 'http';
import { logger } from '../utils/logger.js';
import { getCacheStats } from '../services/scanner.js';
import { getCircuitState } from '../utils/fetch.js';
import { getDatabaseStats } from '../services/database.js';
import { getStrategyStats } from '../services/strategies.js';

const PORT = 8081;
const startTime = Date.now();

// Global stats
let totalScans = 0;
let totalTokensFound = 0;
let totalTokensPassed = 0;

export function updateStats(scans: number, found: number, passed: number): void {
  totalScans = scans;
  totalTokensFound = found;
  totalTokensPassed = passed;
}

function getUptime(): string {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${hours}h ${minutes}m ${secs}s`;
}

function createDashboardHTML(): string {
  const uptime = getUptime();
  const circuitState = getCircuitState();
  const dbStats = getDatabaseStats();
  const strategyStats = getStrategyStats();
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PumpSol - Meme Coin Scanner</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      color: #fff;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      padding: 40px 0;
    }
    .header h1 {
      font-size: 3rem;
      background: linear-gradient(90deg, #00d4ff, #7b2cbf);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 10px;
    }
    .header p {
      color: #888;
      font-size: 1.1rem;
    }
    .status-badge {
      display: inline-block;
      background: #00ff88;
      color: #000;
      padding: 8px 20px;
      border-radius: 20px;
      font-weight: bold;
      margin-top: 15px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 30px 0;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 15px;
      padding: 25px;
      backdrop-filter: blur(10px);
    }
    .card h3 {
      color: #00d4ff;
      font-size: 0.9rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 15px;
    }
    .card .value {
      font-size: 2rem;
      font-weight: bold;
      margin-bottom: 5px;
    }
    .card .label {
      color: #888;
      font-size: 0.85rem;
    }
    .card.green .value { color: #00ff88; }
    .card.purple .value { color: #7b2cbf; }
    .card.orange .value { color: #ff9500; }
    
    .info-section {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 15px;
      padding: 25px;
      margin-top: 20px;
    }
    .info-section h2 {
      color: #00d4ff;
      margin-bottom: 20px;
      font-size: 1.3rem;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
    }
    .info-item {
      display: flex;
      justify-content: space-between;
      padding: 10px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
    }
    .info-item .label { color: #888; }
    .info-item .value { color: #fff; font-weight: bold; }
    
    .links {
      display: flex;
      gap: 15px;
      justify-content: center;
      margin-top: 30px;
      flex-wrap: wrap;
    }
    .links a {
      background: rgba(255, 255, 255, 0.1);
      color: #00d4ff;
      padding: 12px 25px;
      border-radius: 10px;
      text-decoration: none;
      transition: all 0.3s;
    }
    .links a:hover {
      background: #00d4ff;
      color: #000;
    }
    
    .footer {
      text-align: center;
      margin-top: 40px;
      color: #666;
      font-size: 0.85rem;
    }
    .footer a { color: #00d4ff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 PumpSol</h1>
      <p>Solana Meme Coin Scanner with AI Strategies</p>
      <div class="status-badge">● Active</div>
    </div>
    
    <div class="grid">
      <div class="card green">
        <h3>Total Scans</h3>
        <div class="value">${totalScans}</div>
        <div class="label">Scanning cycles completed</div>
      </div>
      <div class="card">
        <h3>Tokens Found</h3>
        <div class="value">${totalTokensFound.toLocaleString()}</div>
        <div class="label">Total tokens scanned</div>
      </div>
      <div class="card purple">
        <h3>Alerts Sent</h3>
        <div class="value">${totalTokensPassed}</div>
        <div class="label">Tokens passed filters</div>
      </div>
      <div class="card orange">
        <h3>Uptime</h3>
        <div class="value">${uptime}</div>
        <div class="label">Server running time</div>
      </div>
    </div>
    
    <div class="info-section">
      <h2>📊 Database & Strategies</h2>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">Tracked Tokens</span>
          <span class="value">${strategyStats?.trackedTokens || 0}</span>
        </div>
        <div class="info-item">
          <span class="label">DB Total Tokens</span>
          <span class="value">${dbStats?.totalTokens || 0}</span>
        </div>
        <div class="info-item">
          <span class="label">Total Alerts</span>
          <span class="value">${dbStats?.totalAlerts || 0}</span>
        </div>
        <div class="info-item">
          <span class="label">Circuit Status</span>
          <span class="value" style="color: ${circuitState === 'OPEN' ? '#ff4444' : '#00ff88'}">${circuitState}</span>
        </div>
        <div class="info-item">
          <span class="label">Volume Spike</span>
          <span class="value">${strategyStats?.strategies?.volumeSpike || '3x'}</span>
        </div>
        <div class="info-item">
          <span class="label">Historical Data</span>
          <span class="value">${strategyStats?.strategies?.useHistoricalData ? 'Enabled' : 'Disabled'}</span>
        </div>
      </div>
    </div>
    
    <div class="info-section">
      <h2>⚙️ Configuration</h2>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">Min Liquidity</span>
          <span class="value">$500</span>
        </div>
        <div class="info-item">
          <span class="label">Min Volume 24h</span>
          <span class="value">$2,000</span>
        </div>
        <div class="info-item">
          <span class="label">Max Holder %</span>
          <span class="value">10%</span>
        </div>
        <div class="info-item">
          <span class="label">Mint Auth Check</span>
          <span class="value">Enabled</span>
        </div>
        <div class="info-item">
          <span class="label">Liquidity Lock</span>
          <span class="value">Enabled</span>
        </div>
        <div class="info-item">
          <span class="label">Scanner Mode</span>
          <span class="value">TRENDING</span>
        </div>
      </div>
    </div>
    
    <div class="links">
      <a href="/health" target="_blank">📊 API Health</a>
      <a href="https://dexscreener.com" target="_blank">📈 DexScreener</a>
      <a href="https://solscan.io" target="_blank">🔍 Solscan</a>
    </div>
    
    <div class="footer">
      <p>PumpSol Scanner v6.0 - Built with ❤️ for Solana Community</p>
      <p>Deployed on <a href="https://render.com">Render</a></p>
    </div>
  </div>
</body>
</html>`;
}

export function startHealthServer(): void {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    
    if (url === '/' || url === '/index.html') {
      // Main dashboard
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(createDashboardHTML());
    } 
    else if (url === '/health' && req.method === 'GET') {
      // Health check API
      const uptime = (Date.now() - startTime) / 1000;
      const cacheStats = getCacheStats();
      const circuitState = getCircuitState();
      const dbStats = getDatabaseStats();
      
      const health = {
        status: 'ok',
        uptime: parseFloat(uptime.toFixed(2)),
        timestamp: new Date().toISOString(),
        scanner: {
          totalScans,
          totalTokensFound,
          totalTokensPassed
        },
        cache: {
          size: cacheStats.size,
          oldestMinutes: cacheStats.oldest
        },
        database: dbStats,
        circuitBreaker: circuitState,
        memory: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
        }
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health, null, 2));
    } 
    else if (url === '/stats' && req.method === 'GET') {
      // Quick stats
      const stats = {
        scans: totalScans,
        found: totalTokensFound,
        passed: totalTokensPassed,
        uptime: getUptime()
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    }
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found - Go to / for dashboard');
    }
  });

  server.listen(PORT, () => {
    logger.success(`Health check server running on http://localhost:${PORT}/`);
  });

  server.on('error', (error) => {
    logger.error('Health server error:', error);
  });
}
