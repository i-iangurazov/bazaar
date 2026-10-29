import Image from "next/image";
import { useId } from "react";

import {
  DashboardIcon,
  ProductsIcon,
  InventoryIcon,
  PosIcon,
  CustomerDatabaseIcon,
  IntegrationsIcon,
} from "@/components/icons";
import type { MarketingCopy, MarketingFeatureId } from "@/content/marketing";
import type { MarketingPreviewData } from "@/content/marketing/preview";

import styles from "./marketing.module.css";

type PreviewCopy = MarketingCopy["preview"];
type PreviewView = MarketingFeatureId | "overview";

// Editorial product illustrations, never a live account or customer data.
const marks = ["CF", "TE", "A5", "H₂O"];
const nav = [
  DashboardIcon,
  PosIcon,
  ProductsIcon,
  InventoryIcon,
  CustomerDatabaseIcon,
  IntegrationsIcon,
];

function ProductMark({ index }: { index: number }) {
  return (
    <span className={styles.previewProductMark} data-color={index % 4} aria-hidden="true">
      {marks[index]}
    </span>
  );
}

function Overview({
  copy,
  data,
  chartId,
}: {
  copy: PreviewCopy;
  data: MarketingPreviewData;
  chartId: string;
}) {
  return (
    <>
      <div className={styles.previewMetrics}>
        {[
          [copy.revenue, data.revenue],
          [copy.receipts, data.receipts],
          [copy.average, data.average],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className={styles.previewChart}>
        <div>
          <strong>{copy.sales}</strong>
          <span>{copy.today}</span>
        </div>
        <svg viewBox="0 0 580 134" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={chartId} x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="currentColor" stopOpacity=".19" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[26, 65, 104].map((y) => (
            <path key={y} d={`M0 ${y}H580`} className={styles.chartGrid} />
          ))}
          <path
            d="M0 113C35 113 48 83 92 86S153 113 192 86S237 100 287 57S338 91 387 53S444 71 481 32S535 46 580 10V134H0Z"
            fill={`url(#${chartId})`}
          />
          <path
            d="M0 113C35 113 48 83 92 86S153 113 192 86S237 100 287 57S338 91 387 53S444 71 481 32S535 46 580 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <div className={styles.chartDays}>
          {copy.days.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
      </div>
      <ProductTable copy={copy} data={data} compact />
    </>
  );
}

function ProductTable({
  copy,
  data,
  compact = false,
}: {
  copy: PreviewCopy;
  data: MarketingPreviewData;
  compact?: boolean;
}) {
  return (
    <div className={styles.previewTable}>
      <div className={styles.previewTableHead}>
        <span>{copy.product}</span>
        <span>{copy.stock}</span>
        <span>{copy.price}</span>
      </div>
      {copy.items.slice(0, compact ? 2 : 4).map((name, index) => (
        <div className={styles.previewTableRow} key={name}>
          <p>
            <ProductMark index={index} />
            <span>
              <strong>{name}</strong>
              <small>SKU {String(index + 101).padStart(5, "0")}</small>
            </span>
          </p>
          <span>
            {data.stock[index]} {copy.units}
          </span>
          <strong>{data.amounts[index]}</strong>
        </div>
      ))}
    </div>
  );
}

function Cashier({ copy, data }: { copy: PreviewCopy; data: MarketingPreviewData }) {
  return (
    <div className={styles.previewPos}>
      <div>
        <div className={styles.previewSearch}>
          <span aria-hidden="true">⌕</span>
          {copy.search}
        </div>
        <span className={styles.previewCategory}>{copy.all}</span>
        <div className={styles.previewProductGrid}>
          {copy.items.map((name, index) => (
            <div key={name}>
              <ProductMark index={index} />
              <strong>{name}</strong>
              <span>{data.amounts[index]}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.previewCart}>
        <span>{copy.retail}</span>
        <strong>{copy.cart}</strong>
        {copy.items.slice(0, 2).map((name, index) => (
          <div key={name}>
            <p>
              {name}
              <small>
                {index ? "1" : "2"} × {data.amounts[index]}
              </small>
            </p>
            <b>{data.cartAmounts[index]}</b>
          </div>
        ))}
        <div className={styles.previewTotal}>
          <span>{copy.total}</span>
          <b>{data.total}</b>
        </div>
        <span className={styles.previewPayment}>{copy.payment}</span>
      </div>
    </div>
  );
}

function Inventory({ copy, data }: { copy: PreviewCopy; data: MarketingPreviewData }) {
  return (
    <>
      <div className={styles.previewBanner}>
        <InventoryIcon size={20} aria-hidden="true" />
        <span>{copy.inventoryNote}</span>
      </div>
      <div className={styles.previewMovementTable}>
        <div className={styles.previewTableHead}>
          <span>{copy.document}</span>
          <span>{copy.operation}</span>
          <span>{copy.quantity}</span>
        </div>
        {[24, -6, -2, 18].map((quantity, index) => (
          <div className={styles.previewMovementRow} key={index}>
            <p>
              <strong>#{String(1004 - index)}</strong>
              <small>{copy.completed}</small>
            </p>
            <span>{copy.operations[index % 3]}</span>
            <b data-positive={quantity > 0}>
              {quantity > 0 ? "+" : "−"}
              {data.quantities[index]}
            </b>
          </div>
        ))}
      </div>
    </>
  );
}

function Customers({ copy, data }: { copy: PreviewCopy; data: MarketingPreviewData }) {
  return (
    <>
      <div className={styles.previewBanner}>
        <CustomerDatabaseIcon size={20} aria-hidden="true" />
        <span>{copy.customerNote}</span>
      </div>
      <div className={styles.previewCustomerTable}>
        <div className={styles.previewTableHead}>
          <span>{copy.customer}</span>
          <span>{copy.orders}</span>
          <span>{copy.total}</span>
        </div>
        {copy.customersList.map((name, index) => (
          <div className={styles.previewTableRow} key={name}>
            <p>
              <span className={styles.customerAvatar}>{name.slice(0, 1)}</span>
              <strong>{name}</strong>
            </p>
            <span>{data.customerOrders[index]}</span>
            <strong>{data.customerTotals[index]}</strong>
          </div>
        ))}
      </div>
    </>
  );
}

function Commerce({ copy }: { copy: PreviewCopy }) {
  return (
    <>
      <div className={styles.previewChannelGrid}>
        {["Bazaar API", "M-Market", "Bakai Store", "O! Market"].map((channel, index) => (
          <div key={channel}>
            <span>{["API", "M", "B", "O!"][index]}</span>
            <strong>{channel}</strong>
            <small>
              {copy.configure} <span aria-hidden="true">↗</span>
            </small>
          </div>
        ))}
      </div>
      <p className={styles.previewFootnote}>{copy.channelNote}</p>
    </>
  );
}

export function MarketingPreview({
  copy,
  data,
  view = "overview",
  className = "",
}: {
  copy: PreviewCopy;
  data: MarketingPreviewData;
  view?: PreviewView;
  className?: string;
}) {
  const chartId = useId();
  const titles: Record<PreviewView, string> = {
    overview: copy.overview,
    cashier: copy.cart,
    inventory: copy.movement,
    products: copy.products,
    customers: copy.customers,
    commerce: copy.channels,
    analytics: copy.overview,
  };
  const description = `${copy.label}: ${titles[view]}`;
  const activeNav = {
    overview: 0,
    cashier: 1,
    products: 2,
    inventory: 3,
    customers: 4,
    commerce: 5,
    analytics: 0,
  }[view];
  return (
    <div
      className={`${styles.preview} ${className}`}
      data-marketing-preview={view}
      role="img"
      aria-label={description}
    >
      <div className={styles.previewWindowBar} aria-hidden="true">
        <span />
        <span />
        <span />
        <p>{copy.domain}</p>
        <b>{copy.demo}</b>
      </div>
      <div className={styles.previewWorkspace} aria-hidden="true">
        <div className={styles.previewRail}>
          <Image src="/brand/icon.png" width={25} height={25} alt="" />
          {nav.map((Icon, index) => (
            <span key={index} data-active={index === activeNav}>
              <Icon size={17} />
            </span>
          ))}
        </div>
        <div className={styles.previewMain}>
          <div className={styles.previewHeading}>
            <p>
              <span>{copy.store}</span>
              <strong>{titles[view]}</strong>
            </p>
            <span>{copy.today}</span>
          </div>
          {view === "overview" || view === "analytics" ? (
            <Overview copy={copy} data={data} chartId={chartId} />
          ) : null}
          {view === "cashier" ? <Cashier copy={copy} data={data} /> : null}
          {view === "inventory" ? <Inventory copy={copy} data={data} /> : null}
          {view === "products" ? (
            <>
              <div className={styles.previewSearch}>
                <span>⌕</span>
                {copy.search}
              </div>
              <ProductTable copy={copy} data={data} />
            </>
          ) : null}
          {view === "customers" ? <Customers copy={copy} data={data} /> : null}
          {view === "commerce" ? <Commerce copy={copy} /> : null}
        </div>
      </div>
    </div>
  );
}
