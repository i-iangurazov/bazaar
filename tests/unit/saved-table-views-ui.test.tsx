// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SavedTableViews } from "@/components/saved-table-views";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
afterEach(cleanup);

const renderViews = () => {
  const onSaveView = vi.fn();
  const onRenameView = vi.fn();
  render(
    <SavedTableViews
      views={[{ id: "tea", name: "Tea", state: {}, createdAt: 1, updatedAt: 1 }]}
      matchingViewId="tea"
      defaultViewId={null}
      onApplyView={vi.fn()}
      onSaveView={onSaveView}
      onRenameView={onRenameView}
      onOverwriteView={vi.fn()}
      onDeleteView={vi.fn()}
      onSetDefaultView={vi.fn()}
    />,
  );
  return { onSaveView, onRenameView, user: userEvent.setup() };
};

describe("saved views keyboard forms", () => {
  it("labels the name, rejects blank names and saves a trimmed name with Enter", async () => {
    const { user, onSaveView } = renderViews();
    await user.click(screen.getByRole("button", { name: "savedViews.save" }));
    const name = screen.getByRole("textbox", { name: "savedViews.nameLabel" });
    expect(
      (screen.getByRole("button", { name: "savedViews.saveConfirm" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await user.type(name, "  Stock check  ");
    await user.keyboard("{Enter}");
    expect(onSaveView).toHaveBeenCalledTimes(1);
    expect(onSaveView).toHaveBeenCalledWith("Stock check");
    expect(screen.queryByRole("textbox", { name: "savedViews.nameLabel" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "savedViews.save" })),
    );
  });

  it("renames the selected view from its menu using Enter", async () => {
    const { user, onRenameView } = renderViews();
    await user.click(screen.getByRole("button", { name: "savedViews.actions" }));
    await user.click(screen.getByRole("menuitem", { name: "savedViews.rename" }));
    const name = screen.getByRole("textbox", { name: "savedViews.nameLabel" });
    expect((name as HTMLInputElement).value).toBe("Tea");
    await user.clear(name);
    await user.type(name, "  Tea and coffee  ");
    await user.keyboard("{Enter}");
    expect(onRenameView).toHaveBeenCalledTimes(1);
    expect(onRenameView).toHaveBeenCalledWith("tea", "Tea and coffee");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "savedViews.actions" }),
      ),
    );
  });
});
