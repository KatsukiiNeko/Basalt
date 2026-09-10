import { useEffect, useRef, useMemo, useCallback } from 'react';
import * as echarts from 'echarts/core';
import { PieChart, BarChart, LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  GraphicComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { aggregateExpensesByCategory, getTopCategories, aggregateMonthlyTrend, transactionsInMonth, trendMonthKeys } from '../utils/chartData';
import { languageLocale } from '../i18n/translations';
import { useCurrency } from '../context/CurrencyContext';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';

// Register ECharts modules (tree-shakeable)
echarts.use([PieChart, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, GraphicComponent, CanvasRenderer]);

// Category → CSS var map; colors match the category icon badges in index.css
const CATEGORY_COLORS = {
  'Food & Dining':     'var(--cat-food)',         // amber
  'Transportation':    'var(--cat-transport)',    // blue
  'Shopping':          'var(--cat-shopping)',     // pink
  'Entertainment':     'var(--cat-entertain)',    // purple (primary)
  'Bills & Utilities': 'var(--cat-bills)',        // orange
  'Healthcare':        'var(--cat-health)',       // green
  'Travel':            'var(--cat-travel)',       // teal
  'Education':         'var(--cat-education)',    // indigo
  'Gifts & Donations': 'var(--cat-gifts)',        // red
  'Other':             'var(--cat-other)',        // gray
};

function getCategoryColor(name) {
  return readCSSVar(CATEGORY_COLORS[name]?.replace('var(', '').replace(')', '') || '--cat-other', '#6b7280');
}

/**
 * Resolve a CSS custom property to a concrete color value. ECharts paints
 * to canvas and can't follow var() references, so theme colors must be
 * read from the DOM at render time.
 */
function readCSSVar(name, fallback) {
  if (typeof document === 'undefined') return fallback;
  try {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue(name).trim();
    return val || fallback;
  } catch { return fallback; }
}

/** Return resolved theme colours (reads DOM at call time) */
function getThemeColors() {
  return {
    cardBg:        readCSSVar('--surface', '#1a1a1e'),
    cardBorder:    readCSSVar('--border', 'rgba(255,255,255,0.07)'),
    bodyBg:        readCSSVar('--bg-primary', '#0d0d0f'),
    textPrimary:   readCSSVar('--text-primary', '#e8e8ec'),
    textSecondary: readCSSVar('--text-secondary', '#8888a0'),
    income:        readCSSVar('--income', '#4ade80'),
    expense:       readCSSVar('--expense', '#f87171'),
    primary:       readCSSVar('--primary', '#814DE5'),
    primaryLight:  readCSSVar('--primary-light', '#a47ef0'),
    grid:          readCSSVar('--border', 'rgba(255,255,255,0.05)'),
  };
}

const chartBaseTextStyle = {
  fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
};

/**
 * Theme-aware palette for canvas rendering. Re-resolves the CSS custom
 * properties whenever `theme` changes; ECharts paints to canvas so it can't
 * follow var() references — concrete values must be re-read per theme.
 */
function useThemeColors() {
  const { theme } = useTheme();
  // `theme` is a deliberate re-render trigger, not a value read inside the
  // factory (getComputedStyle sees whatever `data-theme` is live at call time).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => getThemeColors(), [theme]);
}

/** Format month keys "YYYY-MM" → localized short month + year; locale comes
 *  from the shared i18n map so all languages stay in one place. */
function formatMonthLabel(ym, language = 'EN') {
  const [y, m] = ym.split('-');
  return new Intl.DateTimeFormat(languageLocale[language] || 'en-US', { month: 'short', year: 'numeric' })
    .format(new Date(Number(y), Number(m) - 1, 1));
}

/**
 * Own the ECharts instance lifecycle for one container. The instance is
 * created once per mount and every option change is applied via setOption
 * — disposing and re-initialising on each data change (the pre-V2 approach)
 * re-allocates the canvas and drops tooltip state on every refresh.
 */
function useECharts(option, containerRef, onReady) {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    chartRef.current = echarts.init(containerRef.current, null, { renderer: 'canvas' });

    const handleResize = () => {
      chartRef.current?.resize();
    };
    window.addEventListener('resize', handleResize);

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        chartRef.current?.resize();
      });
      ro.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      ro?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
    // Init runs once per mount. containerRef and onReady are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (option && chartRef.current) {
      chartRef.current.setOption(option, { notMerge: true });
    }
  }, [option]);

  // Event handlers live in consumer closures (useCallback over data), so they
  // must be re-bound when the consumer identity changes — instance reuse
  // alone would leave the doughnut's hover/click handlers reading stale
  // category data. off() first: ECharts stacks listeners, never replaces.
  useEffect(() => {
    if (!onReady || !chartRef.current) return;
    chartRef.current.off();
    onReady(chartRef.current);
  }, [onReady]);
}

// ===========================================================================
// 1. SPENDING DOUGHNUT
// ===========================================================================
const TOP_N = 7; // configurable: number of top categories shown in bar chart

/**
 * Doughnut chart showing expense breakdown by category.
 * Center label updates on slice hover/click.
 * Touch-friendly (triggerOn: 'click' on tooltip).
 */
export function SpendingDoughnut({ categories, formatCurrency, t }) {
  const containerRef = useRef(null);

  // Resolve theme colours once at mount time
  const colors = useThemeColors();
  const totalExpensesLabel = t('dashboard.totalExpenses');
  const total = useMemo(() => categories?.reduce((s, c) => s + c.total, 0) || 0, [categories]);

  const option = useMemo(() => {
    if (!categories || categories.length === 0) return null;

    const data = categories.map(c => ({
      value: c.total,
      name: c.name,
      itemStyle: { color: getCategoryColor(c.name) },
    }));

    return {
      textStyle: chartBaseTextStyle,
      tooltip: {
        trigger: 'item',
        triggerOn: 'click',
        confine: true,
        backgroundColor: colors.cardBg,
        borderColor: colors.cardBorder,
        textStyle: { color: colors.textPrimary, fontSize: 13 },
        formatter(params) {
          const pct = params.percent != null ? params.percent.toFixed(1) : '0.0';
          return `<strong>${params.name}</strong><br/>${formatCurrency(params.value)}<br/>${pct}%`;
        },
      },
      legend: {
        show: true,
        bottom: 0,
        left: 'center',
        textStyle: {
          ...chartBaseTextStyle,
          color: colors.textSecondary,
          fontSize: 11,
        },
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 12,
        type: 'scroll',
      },
      series: [
        {
          name: t('dashboard.expenses'),
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['50%', '46%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderColor: colors.bodyBg,
            borderWidth: 2,
            borderRadius: 4,
          },
          label: {
            show: true,
            position: 'outside',
            formatter: '{b}',
            color: colors.textSecondary,
            fontSize: 10,
            distanceToLabelLine: 4,
          },
          labelLine: {
            length: 16,
            length2: 12,
            lineStyle: { color: colors.cardBorder },
          },
          emphasis: {
            scaleSize: 6,
            label: { fontSize: 13, fontWeight: 600 },
          },
          data,
        },
      ],
      // graphic is set / updated dynamically via chart events to support hover / click interaction
    };
  }, [categories, formatCurrency, t, colors]);

  const onChartReady = useCallback((chart) => {
    const update = (name, value, pct) => {
      chart.setOption({
        graphic: buildCenterGraphic(name, formatCurrency(value), `${pct}%`, colors),
      });
    };

    // Show total by default
    update(totalExpensesLabel, total, 100);

    // Mobile tap-to-toggle: -1 means "showing total"
    let activeIndex = -1;

    const onHover = (params) => {
      const cat = categories?.[params.dataIndex];
      if (cat) {
        update(cat.name, cat.total, (cat.percent * 100).toFixed(1));
      }
    };

    const onOut = () => {
      if (activeIndex === -1) {
        update(totalExpensesLabel, total, 100);
      } else {
        const cat = categories?.[activeIndex];
        if (cat) update(cat.name, cat.total, (cat.percent * 100).toFixed(1));
      }
    };

    const onClick = (params) => {
      if (activeIndex === params.dataIndex) {
        // Toggle off → back to total
        activeIndex = -1;
        update(totalExpensesLabel, total, 100);
      } else {
        activeIndex = params.dataIndex;
        const cat = categories?.[params.dataIndex];
        if (cat) update(cat.name, cat.total, (cat.percent * 100).toFixed(1));
      }
    };

    chart.on('mouseover', { seriesIndex: 0 }, onHover);
    chart.on('mouseout',  { seriesIndex: 0 }, onOut);
    chart.on('globalout',              onOut);
    chart.on('click',     { seriesIndex: 0 }, onClick);
  }, [categories, formatCurrency, total, totalExpensesLabel, colors]);

  useECharts(option, containerRef, onChartReady);

  if (!option) {
    return (
      <div className="chart-empty">
        <span className="chart-empty-text">{t('empty.transactions.title')}</span>
      </div>
    );
  }

  return <div ref={containerRef} className="chart-container chart-doughnut" />;
}

function buildCenterGraphic(name, valueText, pctText, colors) {
  return [
    {
      type: 'text',
      left: 'center',
      top: '40%',
      style: {
        text: name,
        textAlign: 'center',
        fill: colors.textPrimary,
        fontSize: 14,
        fontWeight: 600,
        fontFamily: "'DM Sans', sans-serif",
      },
    },
    {
      type: 'text',
      left: 'center',
      top: '47%',
      style: {
        text: valueText,
        textAlign: 'center',
        fill: colors.textPrimary,
        fontSize: 16,
        fontWeight: 700,
        fontFamily: "'JetBrains Mono', monospace",
      },
    },
    {
      type: 'text',
      left: 'center',
      top: '54%',
      style: {
        text: pctText,
        textAlign: 'center',
        fill: colors.textSecondary,
        fontSize: 12,
        fontFamily: "'DM Sans', sans-serif",
      },
    },
  ];
}

// ===========================================================================
// 2. TOP CATEGORIES HORIZONTAL BAR
// ===========================================================================

/**
 * Horizontal bar chart showing top spending categories ranked.
 * Direct labels on bars — no legend needed.
 */
export function TopCategoriesBar({ categories, totalExpenses, formatCurrency, t }) {
  const containerRef = useRef(null);

  const colors = useThemeColors();

  const option = useMemo(() => {
    if (!categories || categories.length === 0) return null;

    // Reverse so the largest category is at the top
    const reversed = [...categories].reverse();
    const names = reversed.map(c => c.name);
    const values = reversed.map(c => c.total);

    // Determine max label length for left margin
    const maxNameLen = Math.max(...names.map(n => n.length));
    const leftMargin = Math.max(110, maxNameLen * 7);

    return {
      textStyle: chartBaseTextStyle,
      tooltip: {
        trigger: 'axis',
        triggerOn: 'click',
        axisPointer: { type: 'shadow' },
        confine: true,
        backgroundColor: colors.cardBg,
        borderColor: colors.cardBorder,
        textStyle: { color: colors.textPrimary, fontSize: 13 },
        formatter(params) {
          const d = params[0];
          const pct = totalExpenses > 0 ? ((d.value / totalExpenses) * 100).toFixed(1) : '0.0';
          return `<strong>${d.name}</strong><br/>${formatCurrency(d.value)}<br/>${pct}% ${t('dashboard.ofTotal')}`;
        },
      },
      grid: {
        left: leftMargin,
        right: 80,
        top: 8,
        bottom: 4,
        containLabel: false,
      },
      xAxis: {
        type: 'value',
        show: false,
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textPrimary,
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "'DM Sans', sans-serif",
        },
      },
      series: [
        {
          name: t('dashboard.expenses'),
          type: 'bar',
          data: values.map((v, i) => ({
            value: v,
            itemStyle: {
              color: getCategoryColor(reversed[i].name),
              borderRadius: [0, 6, 6, 0],
            },
          })),
          barWidth: 18,
          label: {
            show: true,
            position: 'right',
            color: colors.textSecondary,
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            formatter(params) {
              const pct = totalExpenses > 0 ? ((params.value / totalExpenses) * 100).toFixed(1) : '0.0';
              return `${formatCurrency(params.value)}  ${pct}%`;
            },
            distance: 6,
          },
          emphasis: {
            barWidth: 22,
            label: { fontSize: 13 },
          },
        },
      ],
    };
  }, [categories, totalExpenses, formatCurrency, t, colors]);

  useECharts(option, containerRef);

  if (!option) {
    return (
      <div className="chart-empty">
        <span className="chart-empty-text">{t('empty.transactions.title')}</span>
      </div>
    );
  }

  return <div ref={containerRef} className="chart-container chart-bar" />;
}

// ===========================================================================
// 3. MONTHLY TREND LINE CHART
// ===========================================================================

/**
 * Line chart showing monthly income, expenses, and net.
 */
export function MonthlyTrendLine({ months, income, expense, net, formatCurrency, t, language }) {
  const containerRef = useRef(null);

  // Resolve theme colours once — they're read from CSS custom properties
  const colors = useThemeColors();

  const option = useMemo(() => {
    if (!months || months.length === 0) return null;

    const incomeName  = t('dashboard.income');
    const expenseName = t('dashboard.expenses');
    const netName     = t('dashboard.net');

    return {
      textStyle: chartBaseTextStyle,
      tooltip: {
        trigger: 'axis',
        triggerOn: 'click',
        confine: true,
        backgroundColor: colors.cardBg,
        borderColor: colors.cardBorder,
        textStyle: { color: colors.textPrimary, fontSize: 13 },
        formatter(params) {
          const parts = params.map(p => {
            const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;"></span>`;
            return `${dot}${p.seriesName}: ${formatCurrency(p.value)}`;
          });
          return `<strong>${params[0].axisValue}</strong><br/>${parts.join('<br/>')}`;
        },
      },
      legend: {
        show: true,
        bottom: 0,
        left: 'center',
        textStyle: {
          ...chartBaseTextStyle,
          color: colors.textSecondary,
          fontSize: 11,
        },
        itemWidth: 14,
        itemHeight: 2,
        itemGap: 16,
        icon: 'roundRect',
        data: [incomeName, expenseName, netName],
      },
      grid: {
        left: 12,
        right: 12,
        top: 16,
        bottom: 36,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: months.map(ym => formatMonthLabel(ym, language)),
        axisLine: { lineStyle: { color: colors.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: 11,
          fontFamily: "'DM Sans', sans-serif",
          rotate: months.length > 6 ? 30 : 0,
        },
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: colors.grid, type: 'dashed', width: 0.5 } },
        axisLabel: {
          color: colors.textSecondary,
          fontSize: 10,
          fontFamily: "'JetBrains Mono', monospace",
          formatter(v) {
            if (Math.abs(v) >= 1000000) return (v / 1000000).toFixed(1) + 'M';
            if (Math.abs(v) >= 1000) return (v / 1000).toFixed(0) + 'K';
            return v;
          },
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          name: incomeName,
          type: 'line',
          data: income,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: months.length <= 12,
          lineStyle: { color: colors.income, width: 2.5 },
          itemStyle: { color: colors.income, borderWidth: 2, borderColor: colors.cardBg },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0,   color: colors.income + '33' },  // ~20% opacity
              { offset: 0.7, color: colors.income + '08' },
              { offset: 1,   color: colors.income + '00' },
            ]),
          },
          emphasis: {
            focus: 'series',
            symbolSize: 8,
          },
        },
        {
          name: expenseName,
          type: 'line',
          data: expense,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: months.length <= 12,
          lineStyle: { color: colors.expense, width: 2.5 },
          itemStyle: { color: colors.expense, borderWidth: 2, borderColor: colors.cardBg },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0,   color: colors.expense + '33' },
              { offset: 0.7, color: colors.expense + '08' },
              { offset: 1,   color: colors.expense + '00' },
            ]),
          },
          emphasis: {
            focus: 'series',
            symbolSize: 8,
          },
        },
        {
          name: netName,
          type: 'line',
          data: net,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: months.length <= 12,
          lineStyle: { color: colors.primaryLight, width: 2, type: 'dashed', dashOffset: 2 },
          itemStyle: { color: colors.primaryLight, borderWidth: 2, borderColor: colors.cardBg },
          emphasis: {
            focus: 'series',
            symbolSize: 9,
          },
        },
      ],
    };
  }, [months, income, expense, net, formatCurrency, t, language, colors]);

  useECharts(option, containerRef);

  if (!option) {
    return (
      <div className="chart-empty">
        <span className="chart-empty-text">{t('empty.forecast.title')}</span>
      </div>
    );
  }

  return <div ref={containerRef} className="chart-container chart-line" />;
}

/**
 * Responsive wrapper that lays out the three charts.
 * Mobile: single-column vertical stack.
 * Desktop: two-column grid (line chart spans full width, doughnut + bar side-by-side).
 */
export default function ChartsSection({ transactions, selectedMonth, selectedYear }) {
  const { formatCurrency } = useCurrency();
  const { t, language } = useLanguage();

  // Doughnut and top-categories reflect ONLY the selected month — the same
  // scope the History list and the month balance use. The trend line keeps a
  // window ending at the selected month so it still provides context.
  const monthTransactions = useMemo(
    () => transactionsInMonth(transactions || [], selectedYear, selectedMonth),
    [transactions, selectedYear, selectedMonth]
  );

  const { expenseCategories, topCategories, totalExpenses } = useMemo(() => {
    if (monthTransactions.length === 0) return { expenseCategories: [], topCategories: [], totalExpenses: 0 };
    const { categories: expenseCats, totalExpenses: tot } = aggregateExpensesByCategory(monthTransactions);
    const { categories: topCats } = getTopCategories(monthTransactions, TOP_N);
    return {
      expenseCategories: expenseCats,
      topCategories: topCats,
      totalExpenses: tot,
    };
  }, [monthTransactions]);

  const trend = useMemo(() => {
    // Aggregate once over the full vault (cheap, plain objects), then keep
    // only the window of months ending at the selection.
    const { months, income, expense, net } = aggregateMonthlyTrend(transactions || []);
    const wanted = trendMonthKeys(selectedYear, selectedMonth);
    const windowed = { months: [], income: [], expense: [], net: [] };
    for (const key of wanted) {
      const idx = months.indexOf(key);
      if (idx !== -1) {
        windowed.months.push(months[idx]);
        windowed.income.push(income[idx]);
        windowed.expense.push(expense[idx]);
        windowed.net.push(net[idx]);
      }
    }
    return windowed;
  }, [transactions, selectedYear, selectedMonth]);

  // Month empty state — charts match the History list's scope, so an empty
  // month shows the same guidance instead of stale all-time numbers.
  if (!transactions || transactions.length === 0) {
    return (
      <section className="charts-section">
        <div className="chart-card chart-empty-card">
          <svg className="chart-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
          </svg>
          <p>{t('empty.transactions.desc')}</p>
        </div>
      </section>
    );
  }

  if (monthTransactions.length === 0) {
    return (
      <section className="charts-section">
        <div className="chart-card chart-empty-card">
          <svg className="chart-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
          </svg>
          <p>{t('monthPicker.noData')}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="charts-section">
      {trend.months.length > 0 && (
        <div className="chart-card chart-card-full">
          <h3 className="chart-card-title">{t('dashboard.monthlyTrend')}</h3>
          <MonthlyTrendLine
            months={trend.months}
            income={trend.income}
            expense={trend.expense}
            net={trend.net}
            formatCurrency={formatCurrency}
            t={t}
            language={language}
          />
        </div>
      )}

      <div className="chart-card-row">
        {expenseCategories.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-card-title">{t('dashboard.spendingBreakdown')}</h3>
            <SpendingDoughnut
              categories={expenseCategories}
              formatCurrency={formatCurrency}
              t={t}
            />
          </div>
        )}

        {topCategories.length > 0 && (
          <div className="chart-card">
            <h3 className="chart-card-title">{t('dashboard.topCategories')}</h3>
            <TopCategoriesBar
              categories={topCategories}
              totalExpenses={totalExpenses}
              formatCurrency={formatCurrency}
              t={t}
            />
          </div>
        )}
      </div>
    </section>
  );
}