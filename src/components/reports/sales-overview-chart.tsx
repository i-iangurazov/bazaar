"use client";

import React from "react";
import {
  Bar,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

import { formatKgsMoney, type CurrencySource } from "@/lib/currencyDisplay";
import { formatDate, formatNumber } from "@/lib/i18nFormat";

type SalesPoint = {
  date: string;
  grossSalesKgs: number;
  returnsKgs: number;
  netSalesKgs: number;
  receiptCount: number;
  averageReceiptKgs: number | null;
  costKgs?: number | null;
  grossProfitKgs?: number | null;
};

type ChartLabels = {
  netSales: string;
  grossSales: string;
  returns: string;
  receipts: string;
  averageReceipt: string;
  cost?: string;
  profit?: string;
};

const dateOnlyToDisplayDate = (dateOnly: string) => {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 6, 0, 0, 0));
};

export const SalesOverviewChart = ({
  data,
  labels,
  locale,
  currencySource,
  onSelectDate,
}: {
  data: SalesPoint[];
  labels: ChartLabels;
  locale: string;
  currencySource?: CurrencySource;
  onSelectDate: (date: string) => void;
}) => {
  const renderMoney = (value: number | null | undefined) =>
    value === null || value === undefined ? "—" : formatKgsMoney(value, locale, currencySource);
  const ChartTooltip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) {
      return null;
    }
    const point = payload[0]?.payload as SalesPoint | undefined;
    return (
      <div className="rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
        <p className="font-semibold text-foreground">
          {formatDate(dateOnlyToDisplayDate(String(label)), locale)}
        </p>
        {point ? (
          <div className="mt-2 space-y-1">
            <p>
              {labels.netSales}: {renderMoney(point.netSalesKgs)}
            </p>
            <p>
              {labels.grossSales}: {renderMoney(point.grossSalesKgs)}
            </p>
            <p>
              {labels.returns}: {renderMoney(point.returnsKgs)}
            </p>
            <p>
              {labels.cost}: {renderMoney(point.costKgs)}
            </p>
            <p>
              {labels.profit}: {renderMoney(point.grossProfitKgs)}
            </p>
            <p>
              {labels.receipts}: {formatNumber(point.receiptCount, locale)}
            </p>
            <p>
              {labels.averageReceipt}: {renderMoney(point.averageReceiptKgs)}
            </p>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        className="[--report-cost:#b45309] dark:[--report-cost:#fbbf24]"
        accessibilityLayer
        data={data}
        margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
      >
        <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
        <XAxis
          tick={{ fill: "hsl(var(--muted-foreground))" }}
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => String(value).slice(5)}
          fontSize={12}
        />
        <YAxis
          tick={{ fill: "hsl(var(--muted-foreground))" }}
          yAxisId="sales"
          tickLine={false}
          axisLine={false}
          width={64}
          fontSize={12}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
        <Bar
          isAnimationActive={false}
          yAxisId="sales"
          dataKey="netSalesKgs"
          name={labels.netSales}
          fill="hsl(var(--primary))"
          radius={[4, 4, 0, 0]}
          cursor="pointer"
          onClick={(event: unknown) => {
            const payload = event as { payload?: { date?: string } };
            if (payload.payload?.date) {
              onSelectDate(payload.payload.date);
            }
          }}
        />
        <Line
          yAxisId="sales"
          type="linear"
          dataKey="costKgs"
          name={labels.cost}
          stroke="var(--report-cost)"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="sales"
          type="linear"
          dataKey="grossProfitKgs"
          name={labels.profit}
          stroke="hsl(var(--success))"
          strokeWidth={2}
          dot={{ r: 3 }}
          connectNulls={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};
