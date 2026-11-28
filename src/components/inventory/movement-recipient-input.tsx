"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const listId = "movement-recipient-suggestions";
const optionId = (index: number) => `${listId}-${index}`;

export function MovementRecipientInput({
  storeId,
  value,
  onChange,
  onSelect,
}: {
  storeId?: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (value: string) => void;
}) {
  const t = useTranslations("inventory.movementJournal");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const search = value.trim();
  const settled = useDebouncedValue(search, 220);
  const showOptions = open && search.length >= 2;
  const optionsQuery = trpc.inventory.productMovementRecipientOptions.useQuery(
    { storeId, search: settled },
    { enabled: showOptions && search === settled, retry: false, staleTime: 30_000 },
  );
  const options = search === settled ? optionsQuery.data ?? [] : [];
  const loading = search !== settled || optionsQuery.isFetching;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const select = (name: string) => {
    close();
    onSelect(name);
  };

  return (
    <div className="relative min-w-0 space-y-1">
      <Label htmlFor="movement-recipient">{t("recipient")}</Label>
      <Input
        id="movement-recipient"
        value={value}
        maxLength={160}
        autoComplete="off"
        enterKeyHint="search"
        placeholder={t("recipientPlaceholder")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showOptions}
        aria-controls={showOptions ? listId : undefined}
        aria-activedescendant={
          showOptions && options[active] ? optionId(active) : undefined
        }
        onFocus={() => setOpen(true)}
        onBlur={close}
        onChange={(event) => {
          setOpen(true);
          setActive(-1);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape" && showOptions) {
            event.preventDefault();
            close();
          } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
            event.preventDefault();
            setOpen(true);
            const next = event.key === "ArrowDown"
              ? (active + 1) % options.length
              : (active > 0 ? active : options.length) - 1;
            setActive(next);
            document.getElementById(optionId(next))?.scrollIntoView?.({ block: "nearest" });
          } else if (event.key === "Enter" && showOptions && options[active]) {
            event.preventDefault();
            select(options[active]);
          } else if (event.key === "Enter") {
            close();
          }
        }}
      />
      {showOptions ? (
        <div className="absolute inset-x-0 top-full z-30 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          <ul
            id={listId}
            role="listbox"
            aria-label={t("recipientSuggestions")}
            aria-busy={loading}
            className="max-h-48 overflow-y-auto"
          >
            {options.map((name, index) => (
              <li
                key={name}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                className="cursor-pointer break-words rounded px-2 py-2 text-sm hover:bg-accent aria-selected:bg-accent"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(name)}
              >
                {name}
              </li>
            ))}
          </ul>
          {options.length === 0 ? (
            <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
              {loading
                ? tCommon("loading")
                : optionsQuery.isError
                  ? t("recipientSuggestionsUnavailable")
                  : t("recipientNoSuggestions")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
