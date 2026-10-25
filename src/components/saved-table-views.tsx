"use client";

import { useId, useMemo, useRef, useState } from "react";
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
import { Modal, ModalFooter } from "@/components/ui/modal";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/form-layout";
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
  const nameId = useId();
  const saveTriggerRef = useRef<HTMLButtonElement>(null);
  const actionsTriggerRef = useRef<HTMLButtonElement>(null);

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
        <div className="min-w-0 flex-1 basis-52 sm:w-60 sm:flex-none">
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
            <SelectTrigger aria-label={tCommon("savedViews.selectLabel")}>
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
        <Button
          ref={saveTriggerRef}
          type="button"
          variant="secondary"
          onClick={openSaveDialog}
          disabled={disabled}
        >
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
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  disabled={disabled}
                  aria-label={tCommon("savedViews.actions")}
                  ref={actionsTriggerRef}
                >
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
                    onSetDefaultView(matchingView.id === defaultViewId ? null : matchingView.id)
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
        returnFocusRef={saveTriggerRef}
        onOpenChange={setSaveDialogOpen}
        title={tCommon("savedViews.saveTitle")}
        subtitle={tCommon("savedViews.saveSubtitle")}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!trimmedName) return;
            onSaveView(trimmedName);
            setSaveDialogOpen(false);
          }}
        >
          <Field label={tCommon("savedViews.nameLabel")} htmlFor={`${nameId}-save`}>
            <Input
              id={`${nameId}-save`}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder={tCommon("savedViews.namePlaceholder")}
              autoFocus
            />
          </Field>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setSaveDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={!trimmedName}>
              <CheckIcon className="h-4 w-4" aria-hidden />
              {tCommon("savedViews.saveConfirm")}
            </Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        open={renameDialogOpen}
        returnFocusRef={actionsTriggerRef}
        onOpenChange={setRenameDialogOpen}
        title={tCommon("savedViews.renameTitle")}
        subtitle={tCommon("savedViews.renameSubtitle")}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!matchingView || !trimmedName) return;
            onRenameView(matchingView.id, trimmedName);
            setRenameDialogOpen(false);
          }}
        >
          <Field label={tCommon("savedViews.nameLabel")} htmlFor={`${nameId}-rename`}>
            <Input
              id={`${nameId}-rename`}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder={tCommon("savedViews.namePlaceholder")}
              autoFocus
            />
          </Field>
          <ModalFooter>
            <Button type="button" variant="secondary" onClick={() => setRenameDialogOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="submit" disabled={!matchingView || !trimmedName}>
              <CheckIcon className="h-4 w-4" aria-hidden />
              {tCommon("savedViews.renameConfirm")}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </>
  );
};
