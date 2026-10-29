"use client";
import { useTranslations } from "next-intl";
import { EditIcon } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
export type PriceBookPositionRow = {
  productId: string;
  variantId: string | null;
  label: string;
  sku: string;
  unit: string;
  retail: string;
  wholesale: string;
  draft: boolean;
  selected: boolean;
  sources?: { retail: string; wholesale: string };
};
type Props = {
  rows: PriceBookPositionRow[];
  allSelected: boolean;
  onSelectPage: (v: boolean) => void;
  onSelect: (id: string, value: boolean) => void;
  onEdit: (r: PriceBookPositionRow) => void;
};
const checkboxClass =
  "h-4 w-4 shrink-0 p-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
export function PriceBookPositionList({
  rows,
  allSelected,
  onSelectPage,
  onSelect,
  onEdit,
}: Props) {
  const t = useTranslations("priceBooks"),
    common = useTranslations("common");
  const action = (r: PriceBookPositionRow) => (
    <IconButton
      icon={EditIcon}
      variant="ghost"
      label={`${t("edit")} ${r.label}`}
      onClick={() => onEdit(r)}
    />
  );
  const select = (r: PriceBookPositionRow) =>
    r.variantId === null && (
      <input
        className={checkboxClass}
        type="checkbox"
        aria-label={`${t("select")} ${r.label}`}
        checked={r.selected}
        onChange={(e) => onSelect(r.productId, e.target.checked)}
      />
    );
  const selectPage = (
    <input
      className={checkboxClass}
      type="checkbox"
      aria-label={t("selectPage")}
      checked={allSelected}
      onChange={(e) => onSelectPage(e.target.checked)}
    />
  );
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border md:block">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="p-3">{selectPage}</th>
              <th className="p-3">{t("product")}</th>
              <th className="p-3">{t("retail")} · KGS</th>
              <th className="p-3">{t("wholesale")} · KGS</th>
              {rows.some((r) => r.sources) && <th className="p-3">{t("priceSource")}</th>}
              <th className="p-3">
                <span className="sr-only">{common("actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={`${r.productId}:${r.variantId ?? "BASE"}`}
                className={r.draft ? "border-t bg-primary/5" : "border-t"}
              >
                <td className="p-3">{select(r)}</td>
                <td className="p-3">
                  <div className="font-medium">{r.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.sku} · {r.unit}
                  </div>
                </td>
                <td className="p-3 tabular-nums">{r.retail}</td>
                <td className="p-3 tabular-nums">{r.wholesale}</td>
                {r.sources && (
                  <td className="p-3 text-xs">
                    {t("retail")}: {r.sources.retail}
                    <br />
                    {t("wholesale")}: {r.sources.wholesale}
                  </td>
                )}
                <td className="p-3">{action(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        <label className="flex items-center gap-2 text-sm">
          {selectPage}
          {t("selectPage")}
        </label>
        {rows.map((r) => (
          <article
            key={`${r.productId}:${r.variantId ?? "BASE"}`}
            className={`rounded-lg border p-3 ${r.draft ? "bg-primary/5" : "bg-card"}`}
          >
            <div className="flex items-start gap-3">
              <div className="pt-2">{select(r)}</div>
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{r.label}</p>
                <p className="text-xs text-muted-foreground">
                  {r.sku} · {r.unit}
                </p>
              </div>
              {action(r)}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{t("retail")} · KGS</dt>
                <dd className="tabular-nums">{r.retail}</dd>
                {r.sources && <dd className="text-xs text-muted-foreground">{r.sources.retail}</dd>}
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">{t("wholesale")} · KGS</dt>
                <dd className="tabular-nums">{r.wholesale}</dd>
                {r.sources && (
                  <dd className="text-xs text-muted-foreground">{r.sources.wholesale}</dd>
                )}
              </div>
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
