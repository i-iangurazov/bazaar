import { useTranslations } from "next-intl";
import { MarketingIcon } from "./MarketingIcon";
import styles from "./marketing.module.css";

/** Localized illustration of existing dashboard fields; all values are demo data. */
export const ProductPreview = () => {
  const t = useTranslations("marketing.preview");
  const days = t.raw("days") as string[];
  return (
    <figure className={styles.preview} aria-label={t("label")}>
      <div className={styles.previewBar}>
        <span className={styles.previewDots}>
          <i />
          <i />
          <i />
        </span>
        <span>{t("host")}</span>
        <span className={styles.previewDemo}>{t("demo")}</span>
      </div>
      <div className={styles.previewWorkspace}>
        <aside className={styles.previewSidebar} aria-hidden="true">
          <b>
            {t("brand").slice(0, 1)}
            <span>{t("brand").slice(1)}</span>
          </b>
          {(["chart", "receipt", "box", "people", "store"] as const).map((icon, i) => (
            <div className={i === 0 ? styles.previewActive : ""} key={icon}>
              <MarketingIcon name={icon} />
              <span>{(t.raw("navigation") as string[])[i]}</span>
            </div>
          ))}
          <small>
            <span>A</span>
            {t("owner")}
          </small>
        </aside>
        <div className={styles.previewContent}>
          <div className={styles.previewHeading}>
            <div>
              <span>{t("store")}</span>
              <strong>{t("overview")}</strong>
            </div>
            <span className={styles.previewPeriod}>{t("today")}</span>
          </div>
          <div className={styles.previewMetrics}>
            <div>
              <span>{t("sales")}</span>
              <strong>
                28 450 <small>{t("currency")}</small>
              </strong>
              <span>{t("completed")}</span>
            </div>
            <div>
              <span>{t("receipts")}</span>
              <strong>38</strong>
              <span>{t("today")}</span>
            </div>
          </div>
          <div className={styles.previewChart}>
            <div>
              <strong>{t("week")}</strong>
              <span>{t("currency")}</span>
            </div>
            <div className={styles.bars} aria-label={t("chartLabel")} role="img">
              {[48, 63, 42, 76, 57, 91, 71].map((height, i) => (
                <div key={i}>
                  <span style={{ height: `${height}%` }} />
                  <small>{days[i]}</small>
                </div>
              ))}
            </div>
          </div>
          <div className={styles.previewStock}>
            <div>
              <MarketingIcon name="box" />
              <strong>{t("top")}</strong>
            </div>
            {(t.raw("products") as string[]).slice(0, 2).map((name, i) => (
              <div key={name}>
                <span className={styles.productSwatch} data-color={i} />
                <span>{name}</span>
                <b>
                  {[18, 12][i]} <small>{t("units")}</small>
                </b>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption>{t("caption")}</figcaption>
    </figure>
  );
};

export const MobilePreview = () => {
  const t = useTranslations("marketing.preview");
  return (
    <div className={styles.phone} role="img" aria-label={t("mobileLabel")}>
      <div className={styles.phoneCamera} aria-hidden="true" />
      <div className={styles.phoneHeader}>
        <span>{t("brand")}</span>
        <MarketingIcon name="menu" />
      </div>
      <div className={styles.phoneStore}>
        <MarketingIcon name="store" />
        {t("store")}
      </div>
      <h3>{t("productsTitle")}</h3>
      <div className={styles.phoneSearch}>
        <MarketingIcon name="search" />
        {t("search")}
      </div>
      {(t.raw("products") as string[]).map((name, i) => (
        <div className={styles.phoneProduct} key={name}>
          <span className={styles.productSwatch} data-color={i} />
          <div>
            <b>{name}</b>
            <span>
              {[750, 1200, 490][i]} {t("currency")}
            </span>
          </div>
          <strong>
            {[24, 18, 36][i]}
            <small>{t("units")}</small>
          </strong>
        </div>
      ))}
      <div className={styles.phoneFooter}>
        <MarketingIcon name="chart" />
        <MarketingIcon name="box" />
        <MarketingIcon name="receipt" />
        <MarketingIcon name="people" />
      </div>
    </div>
  );
};
