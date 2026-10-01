import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { loyaltyPaths } from "@/content/help/loyalty-paths";
import type { HelpLocale } from "@/content/help/types";
import { helpText as t, localize } from "@/content/help/ui";
import { HelpIcon } from "./HelpIcon";
import styles from "./help.module.css";

export function HelpLoyaltyPaths({ locale }: { locale: HelpLocale }) {
  return (
    <div className={styles.loyaltyPaths}>
      <div className={styles.loyaltyPathGrid}>
        {loyaltyPaths.map((path) => (
          <Link key={path.guideId} href={`/help/${path.guideId}`} className={styles.loyaltyPath}>
            <span className={styles.loyaltyAudience}>
              <HelpIcon name={path.icon} />
              {localize(path.audience, locale)}
            </span>
            <strong>{localize(path.title, locale)}</strong>
            <p>{localize(path.description, locale)}</p>
            <ArrowRightIcon aria-hidden />
          </Link>
        ))}
      </div>
      <Link href="/help/loyalty/orders-and-returns" className={styles.loyaltyReturns}>
        <span>
          <strong>
            {localize(
              t(
                "Возврат, отмена или онлайн-заказ",
                "Кайтаруу, жокко чыгаруу же онлайн буйрутма",
                "Returns, cancellations and online orders",
              ),
              locale,
            )}
          </strong>
          <small>
            {localize(
              t(
                "Как меняются деньги и баллы; что проверить при расхождении.",
                "Акча жана упай кантип өзгөрөт; айырма болгондо эмнени текшерүү керек.",
                "How money and points change, and what to check when they differ.",
              ),
              locale,
            )}
          </small>
        </span>
        <ArrowRightIcon aria-hidden />
      </Link>
    </div>
  );
}
