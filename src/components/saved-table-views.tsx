"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, MoreIcon, ViewIcon } from "@/components/icons";
import type { SavedTableView } from "@/lib/saved-table-views";

const currentViewValue = "__current__";

export const SavedTableViews = <TState,>({
  views,
  matchingViewId,
  defaultViewId,
  disabled = false,
  onApplyView,
  onSaveView,
  onRenameView,
  onOverwriteView,
  onDeleteView,
  onSetDefaultView,
}: {
  views: SavedTableView<TState>[];
  matchingViewId: string | null;
  defaultViewId: string | null;
  disabled?: boolean;
  onApplyView: (viewId: string) => void;
  onSaveView: (name: string) => void;
  onRenameView: (viewId: string, nextName: string) => void;
  onOverwriteView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
  onSetDefaultView: (viewId: string | null) => void;
}) => {
  const tCommon = useTranslations("common");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [draftName, setDraftName] = useState("");

  const matchingView = useMemo(
    () => views.find((view) => view.id === matchingViewId) ?? null,
    [matchingViewId, views],
  );

  const openSaveDialog = () => {
    setDraftName("");
    setSaveDialogOpen(true);
  };

  const openRenameDialog = () => {
    if (!matchingView) {
      return;
    }
    setDraftName(matchingView.name);
    setRenameDialogOpen(true);
  };

  const trimmedName = draftName.trim();

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[220px] flex-1 sm:min-w-[240px] sm:flex-none">
          <Select
            value={matchingViewId ?? currentViewValue}
            onValueChange={(value) => {
              if (value === currentViewValue) {
                return;
              }
              onApplyView(value);
            }}
            disabled={disabled}
          >
            <SelectTrigger aria-label={tCommon("savedViews.selectLabel")} className="h-9">
              <SelectValue placeholder={tCommon("savedViews.selectLabel")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={currentViewValue}>{tCommon("savedViews.currentView")}</SelectItem>
              {views.map((view) => (
                <SelectItem key={view.id} value={view.id}>
                  {view.name}
                  {view.id === defaultViewId ? ` • ${tCommon("savedViews.defaultBadge")}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={openSaveDialog} disabled={disabled}>
          <ViewIcon className="h-4 w-4" aria-hidden />
          {tCommon("savedViews.save")}
        </Button>
        {matchingView ? (
          <>
            {matchingView.id === defaultViewId ? (
              <Badge variant="muted">{tCommon("savedViews.defaultBadge")}</Badge>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="icon" disabled={disabled} aria-label={tCommon("savedViews.actions")}>
                  <MoreIcon className="h-4 w-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{matchingView.name}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={openRenameDialog}>
                  {tCommon("savedViews.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOverwriteView(matchingView.id)}>
                  {tCommon("savedViews.overwrite")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    onSetDefaultView(
                      matchingView.id === defaultViewId ? null : matchingView.id,
                    )
                  }
                >
                  {matchingView.id === defaultViewId
                    ? tCommon("savedViews.clearDefault")
                    : tCommon("savedViews.setDefault")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-danger focus:text-danger"
                  onSelect={() => onDeleteView(matchingView.id)}
                >
                  {tCommon("savedViews.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>

      <Modal
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        title={tCommon("savedViews.saveTitle")}
        subtitle={tCommon("savedViews.saveSubtitle")}
      >
        <div className="space-y-4">
          <Input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={tCommon("savedViews.namePlaceholder")}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setSaveDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!trimmedName) {
                  return;
                }
                onSaveView(trimmedName);
                setSaveDialogOpen(false);
              }}
              disabled={!trimmedName}
            >
              <CheckIcon className="h-4 w-4" aria-hidden />
              {tCommon("savedViews.saveConfirm")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        title={tCommon("savedViews.renameTitle")}
        subtitle={tCommon("savedViews.renameSubtitle")}
      >
        <div className="space-y-4">
          <Input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder={tCommon("savedViews.namePlaceholder")}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRenameDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!matchingView || !trimmedName) {
                  return;
                }
                onRenameView(matchingView.id, trimmedName);
                setRenameDialogOpen(false);
              }}
              disabled={!matchingView || !trimmedName}
            >
              <CheckIcon className="h-4 w-4" aria-hidden />
              {tCommon("savedViews.renameConfirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
};
