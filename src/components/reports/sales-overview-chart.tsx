"use client";

import React from "react";
import {
  Bar,
  BarChart,
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
  averageReceiptKgs: number;
};

type ChartLabels = {
  netSales: string;
  grossSales: string;
  returns: string;
  receipts: string;
  averageReceipt: string;
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
  const renderMoney = (value: number) => formatKgsMoney(value, locale, currencySource);
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
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => String(value).slice(5)}
          fontSize={12}
        />
        <YAxis yAxisId="sales" tickLine={false} axisLine={false} width={64} fontSize={12} />
        <YAxis
          yAxisId="receipts"
          orientation="right"
          tickLine={false}
          axisLine={false}
          width={42}
          fontSize={12}
        />
        <Tooltip content={<ChartTooltip />} />
        <Legend />
        <Bar
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
          yAxisId="receipts"
          type="monotone"
          dataKey="receiptCount"
          name={labels.receipts}
          stroke="hsl(var(--warning))"
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{
            r: 6,
            onClick: (_event: unknown, payload: unknown) => {
              const point = payload as { payload?: { date?: string } };
              if (point.payload?.date) {
                onSelectDate(point.payload.date);
              }
            },
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};
