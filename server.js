const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Body parser middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// CSP headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; " +
    "font-src 'self' https://fonts.gstatic.com https://cdnjs.cloudflare.com https://frontend-cdn.perplexity.ai; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https:; " +
    "frame-src 'self';"
  );
  next();
});

// Serve static files from files directory and root
app.use('/Review Company - iScreening_files', express.static(path.join(__dirname, 'Review Company - iScreening_files')));
app.use(express.static(__dirname));

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Review Company - iScreening.html'));
});

// Benchmark creator route
app.get('/benchmark-creator', (req, res) => {
  res.sendFile(path.join(__dirname, 'benchmark-creator.html'));
});

// Load mock companies data
const companiesPath = path.join(__dirname, 'MockData', 'companies.json');
let companiesData = [];
try {
  companiesData = JSON.parse(fs.readFileSync(companiesPath, 'utf8'));
} catch (err) {
  console.error("Failed to load companies mock data:", err);
}

// Route to get list of companies (used in drawer)
app.get('/api/companies', (req, res) => {
  res.json(companiesData.map(c => ({
    id: c.id,
    name: c.name,
    country: c.country,
    language: c.language,
    fye: c.fye,
    sector: c.sector,
    regNo: c.regNo,
    activities: c.activities,
    snippets: c.snippets
  })));
});

// Route to fetch full data of a specific company
app.get('/api/companies/:id', (req, res) => {
  const company = companiesData.find(c => c.id === req.params.id);
  if (company) {
    res.json(company);
  } else {
    res.status(404).json({ error: "Company not found" });
  }
});

// Helper function to format currency
function formatCurrency(val) {
  return Number(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Form parser function for URL-encoded iScreening submissions
function parseForm(body) {
  let data = {
    GrossRevenue: parseFloat(body.GrossRevenue) || 0,
    GrossProfitLoss: parseFloat(body.GrossProfitLoss) || 0,
    TotalAsset: parseFloat(body.TotalAsset) || 0,
    InterestIncome: parseFloat(body.InterestIncome) || 0,
    Dividend: parseFloat(body.Dividend) || 0,
    ShariahStandard: body.ShariahStandard || 'SC_Malaysia',
    AccountsReceivables: parseFloat(body.AccountsReceivables) || 3500000,
    AvgMarketCap: parseFloat(body.AvgMarketCap) || 30000000,
    CashAndDebts: [],
    CompanyActivities: []
  };

  for (let key in body) {
    let cashMatch = key.match(/^CashAndDebts\[(\d+)\]\.(.+)$/);
    if (cashMatch) {
      let index = parseInt(cashMatch[1]);
      let prop = cashMatch[2];
      if (!data.CashAndDebts[index]) data.CashAndDebts[index] = {};
      data.CashAndDebts[index][prop] = body[key];
    }

    let activityMatch = key.match(/^CompanyActivities\[(\d+)\]\.(.+)$/);
    if (activityMatch) {
      let index = parseInt(activityMatch[1]);
      let prop = activityMatch[2];
      if (!data.CompanyActivities[index]) data.CompanyActivities[index] = {};
      data.CompanyActivities[index][prop] = body[key];
    }
  }

  // Clean arrays and format numbers
  data.CashAndDebts = data.CashAndDebts.filter(x => x !== undefined);
  data.CompanyActivities = data.CompanyActivities.filter(x => x !== undefined);

  data.CashAndDebts.forEach(x => {
    x.Amount = parseFloat(x.Amount) || 0;
  });
  data.CompanyActivities.forEach(x => {
    x.TotalAmount = parseFloat(x.TotalAmount) || 0;
    x.ProfitBtax = parseFloat(x.ProfitBtax) || 0;
    x.BenchmarkPercentage = parseFloat(x.BenchmarkPercentage) || 0;
  });

  return data;
}

// POST endpoint: Calculate QA screening result
app.post('/Screening/GetQAResult', (req, res) => {
  const data = parseForm(req.body);
  const std = data.ShariahStandard;

  let isCompliant = true;
  let statusDetail = [];
  let ratiosHTML = '';
  let activitiesHTML = '';

  const grossRevenue = data.GrossRevenue;
  const grossProfitLoss = data.GrossProfitLoss;
  const totalAssets = data.TotalAsset;
  const interestIncome = data.InterestIncome;
  const dividend = data.Dividend;
  const receivables = data.AccountsReceivables;
  const marketCap = data.AvgMarketCap;

  const totalCash = data.CashAndDebts.filter(x => x.TypeName === 'Cash').reduce((sum, x) => sum + x.Amount, 0);
  const totalDebt = data.CashAndDebts.filter(x => x.TypeName === 'Debt').reduce((sum, x) => sum + x.Amount, 0);

  if (std === 'SC_Malaysia') {
    // 1. SC Malaysia Standard
    const cashRatio = totalAssets > 0 ? (totalCash / totalAssets) * 100 : 0;
    const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0;
    const interestRatio = grossRevenue > 0 ? (interestIncome / grossRevenue) * 100 : 0;

    const cashStatus = cashRatio <= 33 ? 'Passed' : 'Failed';
    const debtStatus = debtRatio <= 33 ? 'Passed' : 'Failed';
    if (cashStatus === 'Failed') { isCompliant = false; statusDetail.push("Cash ratio exceeds 33%"); }
    if (debtStatus === 'Failed') { isCompliant = false; statusDetail.push("Debt ratio exceeds 33%"); }

    ratiosHTML = `
      <tr>
        <td style="padding: 10px;"><strong>Cash and cash equivalents / Total Assets</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(totalCash)} / ${formatCurrency(totalAssets)}</td>
        <td style="padding: 10px; text-align: right; color: ${cashStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${cashRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&le; 33.00%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${cashStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${cashStatus}</span></td>
      </tr>
      <tr>
        <td style="padding: 10px;"><strong>Interest-Bearing Debt / Total Assets</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(totalDebt)} / ${formatCurrency(totalAssets)}</td>
        <td style="padding: 10px; text-align: right; color: ${debtStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${debtRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&le; 33.00%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${debtStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${debtStatus}</span></td>
      </tr>
      <tr>
        <td style="padding: 10px;">Interest Income / Gross Revenue (5% Indicator)</td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(interestIncome)} / ${formatCurrency(grossRevenue)}</td>
        <td style="padding: 10px; text-align: right;">${interestRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">Included in 5% bmk</td>
        <td style="padding: 10px; text-align: center;"><span class="badge badge-secondary" style="padding: 5px 10px;">Info</span></td>
      </tr>
    `;

    // Activity screens: 5% and 20%
    // Under SC Malaysia, interest income is evaluated under the 5% revenue/PBT benchmark.
    const activities5 = data.CompanyActivities.filter(x => x.BenchmarkPercentage === 5 || x.BenchmarkName === '5% Benchmark');
    const activities20 = data.CompanyActivities.filter(x => x.BenchmarkPercentage === 20 || x.BenchmarkName === '20% Benchmark');

    const rev5Total = activities5.reduce((sum, x) => sum + x.TotalAmount, 0) + interestIncome;
    const pbt5Total = activities5.reduce((sum, x) => sum + x.ProfitBtax, 0);

    const rev20Total = activities20.reduce((sum, x) => sum + x.TotalAmount, 0);
    const pbt20Total = activities20.reduce((sum, x) => sum + x.ProfitBtax, 0);

    const rev5Ratio = grossRevenue > 0 ? (rev5Total / grossRevenue) * 100 : 0;
    const pbt5Ratio = grossProfitLoss > 0 ? (pbt5Total / grossProfitLoss) * 100 : 0;

    const rev20Ratio = grossRevenue > 0 ? (rev20Total / grossRevenue) * 100 : 0;
    const pbt20Ratio = grossProfitLoss > 0 ? (pbt20Total / grossProfitLoss) * 100 : 0;

    const statusRev5 = rev5Ratio <= 5 ? 'Passed' : 'Failed';
    const statusPbt5 = (grossProfitLoss <= 0 || pbt5Ratio <= 5) ? 'Passed' : 'Failed';
    const statusRev20 = rev20Ratio <= 20 ? 'Passed' : 'Failed';
    const statusPbt20 = (grossProfitLoss <= 0 || pbt20Ratio <= 20) ? 'Passed' : 'Failed';

    if (statusRev5 === 'Failed') { isCompliant = false; statusDetail.push("5% Benchmark Revenue limit exceeded"); }
    if (statusPbt5 === 'Failed') { isCompliant = false; statusDetail.push("5% Benchmark PBT limit exceeded"); }
    if (statusRev20 === 'Failed') { isCompliant = false; statusDetail.push("20% Benchmark Revenue limit exceeded"); }
    if (statusPbt20 === 'Failed') { isCompliant = false; statusDetail.push("20% Benchmark PBT limit exceeded"); }

    activitiesHTML = `
      <div class="row-fluid mrgnTop">
        <h3 style="color: #2c3e50; margin-top: 20px;">Activity Benchmark Performance</h3>
        <table class="table table-bordered table-striped" style="width: 100%;">
          <thead>
            <tr style="background-color: #7f8c8d; color: #fff;">
              <th style="padding: 8px;">Activity Class</th>
              <th style="padding: 8px; text-align: right;">Total Revenue (RM)</th>
              <th style="padding: 8px; text-align: right;">Revenue %</th>
              <th style="padding: 8px; text-align: right;">Total PBT (RM)</th>
              <th style="padding: 8px; text-align: right;">PBT %</th>
              <th style="padding: 8px; text-align: center;">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 8px;"><strong>5% Benchmark Group</strong> (inc. Interest)</td>
              <td style="padding: 8px; text-align: right;">${formatCurrency(rev5Total)}</td>
              <td style="padding: 8px; text-align: right; color: ${statusRev5 === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${rev5Ratio.toFixed(2)}%</td>
              <td style="padding: 8px; text-align: right;">${formatCurrency(pbt5Total)}</td>
              <td style="padding: 8px; text-align: right; color: ${statusPbt5 === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${grossProfitLoss > 0 ? pbt5Ratio.toFixed(2) + '%' : 'N/A'}</td>
              <td style="padding: 8px; text-align: center;"><span class="badge ${statusRev5 === 'Passed' && statusPbt5 === 'Passed' ? 'badge-success' : 'badge-danger'}">${statusRev5 === 'Passed' && statusPbt5 === 'Passed' ? 'Passed' : 'Failed'}</span></td>
            </tr>
            <tr>
              <td style="padding: 8px;"><strong>20% Benchmark Group</strong></td>
              <td style="padding: 8px; text-align: right;">${formatCurrency(rev20Total)}</td>
              <td style="padding: 8px; text-align: right; color: ${statusRev20 === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${rev20Ratio.toFixed(2)}%</td>
              <td style="padding: 8px; text-align: right;">${formatCurrency(pbt20Total)}</td>
              <td style="padding: 8px; text-align: right; color: ${statusPbt20 === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${grossProfitLoss > 0 ? pbt20Ratio.toFixed(2) + '%' : 'N/A'}</td>
              <td style="padding: 8px; text-align: center;"><span class="badge ${statusRev20 === 'Passed' && statusPbt20 === 'Passed' ? 'badge-success' : 'badge-danger'}">${statusRev20 === 'Passed' && statusPbt20 === 'Passed' ? 'Passed' : 'Failed'}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  } else if (std === 'OJK_Indonesia') {
    // 2. OJK Indonesia (POJK 35) Standard
    const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0;
    
    // Non-Halal Income: Interest Income + all non-halal revenues
    const nonHalalRevenues = data.CompanyActivities.reduce((sum, x) => sum + x.TotalAmount, 0);
    const totalNonHalalIncome = interestIncome + nonHalalRevenues;
    const divisor = grossRevenue + interestIncome;
    const nonHalalRatio = divisor > 0 ? (totalNonHalalIncome / divisor) * 100 : 0;

    const debtStatus = debtRatio <= 45 ? 'Passed' : 'Failed';
    const incomeStatus = nonHalalRatio <= 10 ? 'Passed' : 'Failed';

    if (debtStatus === 'Failed') { isCompliant = false; statusDetail.push("Total debt exceeds 45%"); }
    if (incomeStatus === 'Failed') { isCompliant = false; statusDetail.push("Non-halal income ratio exceeds 10%"); }

    ratiosHTML = `
      <tr>
        <td style="padding: 10px;"><strong>Total Interest-Bearing Debt / Total Assets</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(totalDebt)} / ${formatCurrency(totalAssets)}</td>
        <td style="padding: 10px; text-align: right; color: ${debtStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${debtRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&le; 45.00%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${debtStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${debtStatus}</span></td>
      </tr>
      <tr>
        <td style="padding: 10px;"><strong>Non-Halal Income / Total Revenue &amp; Interest</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(totalNonHalalIncome)} / ${formatCurrency(divisor)}</td>
        <td style="padding: 10px; text-align: right; color: ${incomeStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${nonHalalRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&le; 10.00%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${incomeStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${incomeStatus}</span></td>
      </tr>
    `;

    activitiesHTML = `
      <div class="row-fluid mrgnTop">
        <h3 style="color: #2c3e50; margin-top: 20px;">Non-Halal Revenue Stream Contributions (OJK 10% Tolerated)</h3>
        <table class="table table-bordered table-striped" style="width: 100%;">
          <thead>
            <tr style="background-color: #7f8c8d; color: #fff;">
              <th style="padding: 8px;">Activity / Stream</th>
              <th style="padding: 8px; text-align: right;">Amount (RM)</th>
              <th style="padding: 8px; text-align: right;">Percentage of Total Revenue</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="padding: 8px;">Interest Income</td>
              <td style="padding: 8px; text-align: right;">${formatCurrency(interestIncome)}</td>
              <td style="padding: 8px; text-align: right;">${((interestIncome / divisor) * 100).toFixed(2)}%</td>
            </tr>
            ${data.CompanyActivities.map(a => `
              <tr>
                <td style="padding: 8px;">${a.ActivityName}</td>
                <td style="padding: 8px; text-align: right;">${formatCurrency(a.TotalAmount)}</td>
                <td style="padding: 8px; text-align: right;">${((a.TotalAmount / divisor) * 100).toFixed(2)}%</td>
              </tr>
            `).join('')}
            <tr style="font-weight: bold; background-color: #f2f2f2;">
              <td style="padding: 8px;">Total Non-Halal Streams</td>
              <td style="padding: 8px; text-align: right;">${formatCurrency(totalNonHalalIncome)}</td>
              <td style="padding: 8px; text-align: right; color: ${incomeStatus === 'Failed' ? '#e74c3c' : '#27ae60'};">${nonHalalRatio.toFixed(2)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  } else if (std === 'MSCI_Islamic') {
    // 3. MSCI Islamic Index Standard
    const debtRatio = totalAssets > 0 ? (totalDebt / totalAssets) * 100 : 0;
    const cashRatio = totalAssets > 0 ? (totalCash / totalAssets) * 100 : 0;
    
    // Accounts Receivables + Cash / Total Assets
    const recCashTotal = receivables + totalCash;
    const recCashRatio = totalAssets > 0 ? (recCashTotal / totalAssets) * 100 : 0;

    const debtStatus = debtRatio <= 33.33 ? 'Passed' : 'Failed';
    const cashStatus = cashRatio <= 33.33 ? 'Passed' : 'Failed';
    const recStatus = recCashRatio <= 70 ? 'Passed' : 'Failed';

    if (debtStatus === 'Failed') { isCompliant = false; statusDetail.push("Total debt exceeds MSCI 33.33% limit"); }
    if (cashStatus === 'Failed') { isCompliant = false; statusDetail.push("Cash and interest securities exceed MSCI 33.33% limit"); }
    if (recStatus === 'Failed') { isCompliant = false; statusDetail.push("Receivables + Cash exceed MSCI 70% limit"); }

    ratiosHTML = `
      <tr>
        <td style="padding: 10px;"><strong>Total Debt / Total Assets</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(totalDebt)} / ${formatCurrency(totalAssets)}</td>
        <td style="padding: 10px; text-align: right; color: ${debtStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${debtRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&le; 33.33%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${debtStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${debtStatus}</span></td>
      </tr>
      <tr>
        <td style="padding: 10px;"><strong>Cash + Interest-bearing Securities / Total Assets</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(totalCash)} / ${formatCurrency(totalAssets)}</td>
        <td style="padding: 10px; text-align: right; color: ${cashStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${cashRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&le; 33.33%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${cashStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${cashStatus}</span></td>
      </tr>
      <tr>
        <td style="padding: 10px;"><strong>(Accounts Receivables + Cash) / Total Assets</strong></td>
        <td style="padding: 10px; text-align: right;">(${formatCurrency(receivables)} + ${formatCurrency(totalCash)}) / ${formatCurrency(totalAssets)}</td>
        <td style="padding: 10px; text-align: right; color: ${recStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${recCashRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&le; 70.00%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${recStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${recStatus}</span></td>
      </tr>
    `;

    activitiesHTML = `
      <div style="margin-top: 15px; font-size: 13px; color: #555; background-color: #f9f9f9; padding: 10px; border-left: 3px solid #3498db;">
        <strong>MSCI Islamic Note:</strong> Thresholds reflect MSCI entry criteria. MSCI index rebalancing utilizes buffers (e.g. 35% exit for debt/cash) for existing index constituents. Accounts Receivables are extracted from the AI panel data (RM ${formatCurrency(receivables)}).
      </div>
    `;
  } else if (std === 'Dow_Jones') {
    // 4. Dow Jones Islamic Market Standard
    const debtRatio = marketCap > 0 ? (totalDebt / marketCap) * 100 : 0;
    const cashRatio = marketCap > 0 ? (totalCash / marketCap) * 100 : 0;
    const recRatio = marketCap > 0 ? (receivables / marketCap) * 100 : 0;

    const debtStatus = debtRatio < 33 ? 'Passed' : 'Failed';
    const cashStatus = cashRatio < 33 ? 'Passed' : 'Failed';
    const recStatus = recRatio < 33 ? 'Passed' : 'Failed';

    if (debtStatus === 'Failed') { isCompliant = false; statusDetail.push("Total debt exceeds Dow Jones 33% Market Cap limit"); }
    if (cashStatus === 'Failed') { isCompliant = false; statusDetail.push("Cash and securities exceed Dow Jones 33% Market Cap limit"); }
    if (recStatus === 'Failed') { isCompliant = false; statusDetail.push("Receivables exceed Dow Jones 33% Market Cap limit"); }

    ratiosHTML = `
      <tr>
        <td style="padding: 10px;"><strong>Total Debt / Average Market Cap (24-Month)</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(totalDebt)} / ${formatCurrency(marketCap)}</td>
        <td style="padding: 10px; text-align: right; color: ${debtStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${debtRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&lt; 33.00%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${debtStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${debtStatus}</span></td>
      </tr>
      <tr>
        <td style="padding: 10px;"><strong>Cash + Interest Securities / Average Market Cap</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(totalCash)} / ${formatCurrency(marketCap)}</td>
        <td style="padding: 10px; text-align: right; color: ${cashStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${cashRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&lt; 33.00%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${cashStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${cashStatus}</span></td>
      </tr>
      <tr>
        <td style="padding: 10px;"><strong>Accounts Receivables / Average Market Cap</strong></td>
        <td style="padding: 10px; text-align: right;">${formatCurrency(receivables)} / ${formatCurrency(marketCap)}</td>
        <td style="padding: 10px; text-align: right; color: ${recStatus === 'Failed' ? '#e74c3c' : '#27ae60'}; font-weight: bold;">${recRatio.toFixed(2)}%</td>
        <td style="padding: 10px; text-align: right;">&lt; 33.00%</td>
        <td style="padding: 10px; text-align: center;"><span class="badge ${recStatus === 'Passed' ? 'badge-success' : 'badge-danger'}" style="padding: 5px 10px;">${recStatus}</span></td>
      </tr>
    `;

    activitiesHTML = `
      <div style="margin-top: 15px; font-size: 13px; color: #555; background-color: #f9f9f9; padding: 10px; border-left: 3px solid #f1c40f;">
        <strong>Dow Jones Note:</strong> Dow Jones calculations use the company's average market capitalization (24-month trailing) as the denominator, which is set to RM ${formatCurrency(marketCap)}. Receivables are set to RM ${formatCurrency(receivables)}.
      </div>
    `;
  }

  // Create standard label
  let stdLabel = 'SC Malaysia';
  if (std === 'OJK_Indonesia') stdLabel = 'OJK Indonesia (POJK 35)';
  if (std === 'MSCI_Islamic') stdLabel = 'MSCI Islamic Index';
  if (std === 'Dow_Jones') stdLabel = 'Dow Jones Islamic Market';

  const statusVal = isCompliant ? 'ShariahCompliant' : 'ShariahNonCompliant';
  const statusColor = isCompliant ? '#27ae60' : '#e74c3c';
  const statusText = isCompliant ? 'Shariah-Compliant' : 'Shariah Non-Compliant';

  const htmlResponse = `
    <div class="row-fluid mrgnTop consolidated-total" data-qastatus="${statusVal}">
      <div class="col-sm-12 fltLft mrgnTop" style="background: white; border-radius: 8px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); margin-bottom: 25px;">
        <div class="row-fluid" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #ecf0f1; padding-bottom: 10px;">
          <h2 style="margin: 0; font-size: 1.5em; color: #2c3e50; font-family: 'Outfit', sans-serif;">
            Compliance Summary: <span style="color: #3498db;">${stdLabel}</span>
          </h2>
          <div style="background-color: ${statusColor}1A; border: 1px solid ${statusColor}; color: ${statusColor}; padding: 6px 12px; border-radius: 20px; font-weight: bold; font-size: 0.9em; display: inline-flex; align-items: center;">
            <b class="fa ${isCompliant ? 'fa-check-circle' : 'fa-times-circle'}" style="margin-right: 5px;"></b>
            ${statusText}
          </div>
        </div>
        
        <table class="table table-bordered table-hover" style="margin-top: 15px; width: 100%; border-collapse: collapse; font-family: 'Inter', sans-serif;">
          <thead>
            <tr style="background-color: #f8f9fa; border-bottom: 2px solid #dee2e6;">
              <th style="padding: 12px; text-align: left; color: #495057;">Ratio Parameter</th>
              <th style="padding: 12px; text-align: right; color: #495057;">Formula Components</th>
              <th style="padding: 12px; text-align: right; color: #495057;">Actual Ratio</th>
              <th style="padding: 12px; text-align: right; color: #495057;">Rule Limit</th>
              <th style="padding: 12px; text-align: center; color: #495057;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${ratiosHTML}
          </tbody>
        </table>
        
        ${activitiesHTML}
        
        ${!isCompliant ? `
          <div style="background-color: #fdf3f2; border: 1px solid #f5c2c1; color: #c0392b; padding: 12px; border-radius: 6px; margin-top: 15px; font-size: 0.95em;">
            <strong>Violations Detected:</strong>
            <ul style="margin: 5px 0 0 20px; padding: 0;">
              ${statusDetail.map(d => `<li>${d}</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  res.send(htmlResponse);
});

// POST endpoint: Receive uploaded/raw JSON payload and normalize it
app.post('/Screening/NormalizeReviewJson', (req, res) => {
  const { payload } = req.body;
  try {
    const rawData = JSON.parse(payload);
    // Return standard format expected by the frontend
    res.json({
      success: true,
      data: rawData
    });
  } catch (err) {
    res.json({
      success: false,
      error: "Malformed JSON payload: " + err.message
    });
  }
});

// Start the server (local dev only)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SC iScreening Demo Server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
