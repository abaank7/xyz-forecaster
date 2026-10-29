import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import './App.css';

const JAN_PRESETS = [
  { label: 'Week 1 (Jan 01 – Jan 07)', start: '2026-01-01', end: '2026-01-07' },
  { label: 'Week 2 (Jan 08 – Jan 14)', start: '2026-01-08', end: '2026-01-14' },
  { label: 'Week 3 (Jan 15 – Jan 21)', start: '2026-01-15', end: '2026-01-21' },
  { label: 'Week 4 (Jan 22 – Jan 31)', start: '2026-01-22', end: '2026-01-31' },
];

const formatDateTime = (isoString) => {
  if (!isoString) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(new Date(isoString)) + ' UTC';
};

const formatAxisTick = (isoString) => {
  if (!isoString) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  }).format(new Date(isoString));
};

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  const isOverForecast = row.errorMw > 0;

  return (
    <div className="custom-tooltip">
      <div className="tooltip-header">
        <span className="tooltip-time">{formatDateTime(label)}</span>
        <span className={`tooltip-badge ${isOverForecast ? 'badge-warn' : 'badge-ok'}`}>
          {isOverForecast ? 'Thermal Top-Up Risk' : 'Wind Surplus'}
        </span>
      </div>

      <div className="tooltip-grid">
        <div className="tooltip-row">
          <span className="dot dot-actual"></span>
          <span className="tooltip-label">Actual Wind (FUELHH):</span>
          <span className="tooltip-val">{row.actualGeneration?.toLocaleString()} MW</span>
        </div>
        <div className="tooltip-row">
          <span className="dot dot-forecast"></span>
          <span className="tooltip-label">Forecasted (WINDFOR):</span>
          <span className="tooltip-val">{row.forecastGeneration?.toLocaleString()} MW</span>
        </div>
        <div className="tooltip-divider"></div>
        <div className="tooltip-row">
          <span className="tooltip-label">Forecast Error:</span>
          <span className={`tooltip-val ${isOverForecast ? 'text-rose' : 'text-emerald'}`}>
            {row.errorMw > 0 ? `+${row.errorMw.toLocaleString()}` : row.errorMw.toLocaleString()} MW ({row.errorPercentage}%)
          </span>
        </div>
        <div className="tooltip-row">
          <span className="tooltip-label">Forecast Published:</span>
          <span className="tooltip-meta">{formatDateTime(row.forecastPublishTime)}</span>
        </div>
      </div>
    </div>
  );
};

function App() {
  // Default to Light Mode
  const [theme, setTheme] = useState('light');
  const [dateRange, setDateRange] = useState(JAN_PRESETS[0]);
  const [activeTab, setActiveTab] = useState('generation');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sync theme attribute on root HTML element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Dynamic Recharts palette based on active theme
  const chartColors = useMemo(() => {
    const isDark = theme === 'dark';
    return {
      grid: isDark ? '#27272a' : '#e2e8f0',
      axisStroke: isDark ? '#71717a' : '#94a3b8',
      tickFill: isDark ? '#a1a1aa' : '#475569',
      refLine: isDark ? '#52525b' : '#cbd5e1',
      actualStroke: isDark ? '#10b981' : '#059669',
      forecastStroke: isDark ? '#818cf8' : '#4f46e5',
      barPositive: isDark ? '#f43f5e' : '#e11d48',
      barNegative: isDark ? '#10b981' : '#059669',
    };
  }, [theme]);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const query = `start_date=${dateRange.start}&end_date=${dateRange.end}`;

    async function loadWindData() {
      try {
        let res = await fetch(`/api/wind-data?${query}`);
        const contentType = res.headers.get('content-type') || '';

        if (!res.ok || !contentType.includes('application/json')) {
          res = await fetch(`http://127.0.0.1:8000/api/wind-data?${query}`);
        }

        if (!res.ok) {
          throw new Error(`API returned status ${res.status}`);
        }

        const json = await res.json();
        if (isMounted) {
          setData(json.data || []);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to connect to Elexon telemetry service.');
          setLoading(false);
        }
      }
    }

    loadWindData();
    return () => { isMounted = false; };
  }, [dateRange]);

  const stats = useMemo(() => {
    if (!data.length) {
      return {
        mae: 0, mape: 0, rmse: 0, bias: 0, p95Error: 0,
        overForecastPct: 0, peakErrorRow: null, topAnomalies: []
      };
    }

    let sumAbsError = 0;
    let sumPctError = 0;
    let sumSqError = 0;
    let sumNetError = 0;
    let overForecastCount = 0;
    let peakRow = data[0];

    const absErrors = [];

    data.forEach((d) => {
      const absErr = Math.abs(d.errorMw);
      absErrors.push(absErr);
      sumAbsError += absErr;
      sumPctError += Math.abs(d.errorPercentage);
      sumSqError += d.errorMw * d.errorMw;
      sumNetError += d.errorMw;

      if (d.errorMw > 0) overForecastCount += 1;
      if (absErr > Math.abs(peakRow.errorMw)) peakRow = d;
    });

    absErrors.sort((a, b) => a - b);
    const p95Index = Math.floor(absErrors.length * 0.95);

    const topAnomalies = [...data]
      .sort((a, b) => Math.abs(b.errorMw) - Math.abs(a.errorMw))
      .slice(0, 5);

    return {
      mae: Math.round(sumAbsError / data.length),
      mape: (sumPctError / data.length).toFixed(1),
      rmse: Math.round(Math.sqrt(sumSqError / data.length)),
      bias: Math.round(sumNetError / data.length),
      p95Error: Math.round(absErrors[p95Index] || 0),
      overForecastPct: Math.round((overForecastCount / data.length) * 100),
      peakErrorRow: peakRow,
      topAnomalies
    };
  }, [data]);

  return (
    <div className="terminal-shell" data-theme={theme}>
      {/* Top Navbar */}
      <nav className="topbar">
        <div className="topbar-left">
          <div className="brand-mark">
            {/* <span className="brand-square"></span> */}
            {/* <span className="brand-name">GRIDBRICKS</span> */}
          </div>
          {/* <span className="topbar-divider">/</span> */}
          <span className="topbar-subtitle">UK Day-Ahead Wind Procurement Desk</span>
        </div>

        <div className="topbar-right">
          {/* <div className="status-pill">
            <span className="status-dot"></span>
            <span>ELEXON BMRS STREAM</span>
          </div> */}
          <div className="market-tag">JAN 2026 SETTLEMENT</div>

          <button
            onClick={toggleTheme}
            className="theme-toggle-btn"
            aria-label="Toggle color theme"
            title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
          >
            {theme === 'light' ? (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
                <span>Dark</span>
              </>
            ) : (
              <>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
                <span>Light</span>
              </>
            )}
          </button>
        </div>
      </nav>

      <main className="terminal-main">
        {/* Control Header */}
        <section className="control-bar">
          <div>
            <h1 className="page-title">National Wind Generation & Forecast Accuracy</h1>
            <p className="page-desc">
              Day-ahead wholesale procurement intelligence comparing Elexon <code>WINDFOR</code> forecasts against <code>FUELHH</code> actuals.
            </p>
          </div>

          <div className="preset-group">
            {JAN_PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => setDateRange(preset)}
                className={`preset-btn ${dateRange.start === preset.start ? 'active' : ''}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </section>

        {loading ? (
          <div className="skeleton-wrapper">
            <div className="skeleton-kpi-row">
              {[1, 2, 3, 4].map((n) => <div key={n} className="skeleton-card"></div>)}
            </div>
            <div className="skeleton-chart">
              <div className="spinner"></div>
              <p>Synchronizing Elexon FUELHH & WINDFOR telemetry...</p>
            </div>
          </div>
        ) : error ? (
          <div className="error-panel">
            <h3>Telemetry Synchronization Error</h3>
            <p>{error}</p>
            <button onClick={() => setDateRange({ ...dateRange })} className="retry-btn">
              Retry Connection
            </button>
          </div>
        ) : (
          <>
            {/* Quantitative KPI Strip */}
            <section className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-title">Mean Absolute Error (MAE)</span>
                  <span className="kpi-tag">RMSE: {stats.rmse.toLocaleString()} MW</span>
                </div>
                <div className="kpi-value">
                  {stats.mae.toLocaleString()} <span className="kpi-unit">MW</span>
                </div>
                <p className="kpi-foot">Average magnitude of deviation across {data.length} intervals</p>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-title">Mean Abs. Percentage Error</span>
                  <span className={`kpi-badge ${Number(stats.mape) < 15 ? 'badge-emerald' : 'badge-amber'}`}>
                    {Number(stats.mape) < 15 ? 'High Confidence' : 'Moderate Variance'}
                  </span>
                </div>
                <div className="kpi-value">
                  {stats.mape}<span className="kpi-unit">%</span>
                </div>
                <p className="kpi-foot">Relative forecast error vs. actual wind delivery</p>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-title">Net Forecast Bias</span>
                  <span className={`kpi-badge ${stats.bias > 0 ? 'badge-rose' : 'badge-emerald'}`}>
                    {stats.bias > 0 ? 'Over-Forecasted' : 'Under-Forecasted'}
                  </span>
                </div>
                <div className="kpi-value">
                  {stats.bias > 0 ? `+${stats.bias.toLocaleString()}` : stats.bias.toLocaleString()}{' '}
                  <span className="kpi-unit">MW</span>
                </div>
                <p className="kpi-foot">
                  Over-forecasted in {stats.overForecastPct}% of hours (requires thermal backup)
                </p>
              </div>

              <div className="kpi-card">
                <div className="kpi-header">
                  <span className="kpi-title">P95 Procurement Buffer</span>
                  <span className="kpi-tag">95th Percentile</span>
                </div>
                <div className="kpi-value">
                  {stats.p95Error.toLocaleString()} <span className="kpi-unit">MW</span>
                </div>
                <p className="kpi-foot">Recommended non-renewable reserve margin for 95% coverage</p>
              </div>
            </section>

            {/* Primary Interactive Visualization */}
            <section className="panel chart-panel">
              <div className="panel-header">
                <div>
                  <h2 className="panel-title">
                    {activeTab === 'generation'
                      ? 'Actual vs. Day-Ahead Forecasted Wind Generation (MW)'
                      : 'Hourly Forecast Error & Thermal Balancing Requirement (MW)'}
                  </h2>
                  <p className="panel-subtitle">
                    {activeTab === 'generation'
                      ? 'Comparing national metered wind output against latest day-ahead forecast stream'
                      : 'Positive values (+MW) indicate wind shortfall where forecast exceeded actual generation'}
                  </p>
                </div>

                <div className="tab-Right">
                  <div className="legend-inline">
                    {activeTab === 'generation' ? (
                      <>
                        <span className="legend-item"><i className="dot dot-actual"></i> Actual (FUELHH)</span>
                        <span className="legend-item"><i className="dot dot-forecast"></i> Forecast (WINDFOR)</span>
                      </>
                    ) : (
                      <>
                        <span className="legend-item"><i className="dot dot-rose"></i> Wind Deficit (Buy Thermal)</span>
                        <span className="legend-item"><i className="dot dot-actual"></i> Wind Surplus</span>
                      </>
                    )}
                  </div>

                  <div className="view-switcher">
                    <button
                      className={`switch-btn ${activeTab === 'generation' ? 'active' : ''}`}
                      onClick={() => setActiveTab('generation')}
                    >
                      Generation Curve
                    </button>
                    <button
                      className={`switch-btn ${activeTab === 'error' ? 'active' : ''}`}
                      onClick={() => setActiveTab('error')}
                    >
                      Error Deviation
                    </button>
                  </div>
                </div>
              </div>

              <div className="chart-canvas">
                <ResponsiveContainer width="100%" height={400}>
                  {activeTab === 'generation' ? (
                    <AreaChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={chartColors.actualStroke} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={chartColors.actualStroke} stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="gradForecast" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={chartColors.forecastStroke} stopOpacity={0.22} />
                          <stop offset="95%" stopColor={chartColors.forecastStroke} stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.grid} />
                      <XAxis
                        dataKey="startTime"
                        tickFormatter={formatAxisTick}
                        stroke={chartColors.axisStroke}
                        tick={{ fill: chartColors.tickFill, fontSize: 12 }}
                        minTickGap={45}
                      />
                      <YAxis
                        stroke={chartColors.axisStroke}
                        tick={{ fill: chartColors.tickFill, fontSize: 12 }}
                        tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
                        label={{ value: 'Power (MW)', angle: -90, position: 'insideLeft', fill: chartColors.tickFill, fontSize: 12 }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <Area
                        type="monotone"
                        dataKey="actualGeneration"
                        stroke={chartColors.actualStroke}
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#gradActual)"
                      />
                      <Area
                        type="monotone"
                        dataKey="forecastGeneration"
                        stroke={chartColors.forecastStroke}
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        fillOpacity={1}
                        fill="url(#gradForecast)"
                      />
                    </AreaChart>
                  ) : (
                    <BarChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartColors.grid} />
                      <XAxis
                        dataKey="startTime"
                        tickFormatter={formatAxisTick}
                        stroke={chartColors.axisStroke}
                        tick={{ fill: chartColors.tickFill, fontSize: 12 }}
                        minTickGap={45}
                      />
                      <YAxis
                        stroke={chartColors.axisStroke}
                        tick={{ fill: chartColors.tickFill, fontSize: 12 }}
                        label={{ value: 'Error (MW)', angle: -90, position: 'insideLeft', fill: chartColors.tickFill, fontSize: 12 }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine y={0} stroke={chartColors.refLine} strokeWidth={1.5} />
                      <Bar dataKey="errorMw" radius={[2, 2, 0, 0]}>
                        {data.map((entry, idx) => (
                          <Cell
                            key={`cell-${idx}`}
                            fill={entry.errorMw > 0 ? chartColors.barPositive : chartColors.barNegative}
                            fillOpacity={0.85}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </section>

            {/* Bottom Trader Decision Intelligence & Anomaly Table */}
            <section className="bottom-grid">
              <div className="panel guidance-panel">
                <h3 className="panel-title">Day-Ahead Trader Decision Guidance</h3>
                <p className="panel-subtitle">Actionable risk translation for thermal power procurement</p>

                <div className="insight-list">
                  <div className="insight-item">
                    <span className="insight-label">Primary Procurement Risk</span>
                    <p className="insight-text">
                      When <strong>Forecast &gt; Actual</strong> (positive error), national wind falls short of expectations.
                      During this window, wind was over-forecasted in <strong>{stats.overForecastPct}%</strong> of settlement periods,
                      requiring additional thermal generation dispatch.
                    </p>
                  </div>

                  <div className="insight-item">
                    <span className="insight-label">Recommended Hedging Strategy</span>
                    <p className="insight-text">
                      Apply a baseline haircut of <strong>{stats.mae.toLocaleString()} MW (MAE)</strong> to raw day-ahead wind forecasts,
                      and maintain <strong>{stats.p95Error.toLocaleString()} MW (P95)</strong> of flexible thermal reserve capacity
                      to protect against tail-risk forecast errors.
                    </p>
                  </div>

                  {stats.peakErrorRow && (
                    <div className="insight-item highlight-box">
                      <span className="insight-label">Peak Deviation Event</span>
                      <p className="insight-text">
                        Largest miss occurred at <strong>{formatDateTime(stats.peakErrorRow.startTime)}</strong> with a{' '}
                        <span className="text-rose font-semibold">
                          {stats.peakErrorRow.errorMw > 0 ? `+${stats.peakErrorRow.errorMw}` : stats.peakErrorRow.errorMw} MW
                        </span>{' '}
                        ({stats.peakErrorRow.errorPercentage}%) variance.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="panel table-panel">
                <h3 className="panel-title">Largest Forecast Deviations (Top 5 Intervals)</h3>
                <p className="panel-subtitle">Highest absolute variance periods requiring balancing intervention</p>

                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Target Time (UTC)</th>
                        <th>Actual</th>
                        <th>Forecast</th>
                        <th>Error (MW)</th>
                        <th>Error (%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.topAnomalies.map((row) => (
                        <tr key={row.startTime}>
                          <td className="mono">{formatDateTime(row.startTime)}</td>
                          <td className="mono">{row.actualGeneration.toLocaleString()} MW</td>
                          <td className="mono">{row.forecastGeneration.toLocaleString()} MW</td>
                          <td className={`mono font-semibold ${row.errorMw > 0 ? 'text-rose' : 'text-emerald'}`}>
                            {row.errorMw > 0 ? `+${row.errorMw.toLocaleString()}` : row.errorMw.toLocaleString()} MW
                          </td>
                          <td className="mono">{row.errorPercentage}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default App;