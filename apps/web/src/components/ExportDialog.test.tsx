// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ExportDialog } from "./ExportDialog";

afterEach(cleanup);

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open exports</button>
      <ExportDialog open={open} onClose={() => setOpen(false)}>
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </ExportDialog>
    </>
  );
}

describe("ExportDialog", () => {
  it("traps focus, closes with Escape, restores focus, and locks page scrolling", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open exports" });

    await user.click(trigger);
    const close = screen.getByRole("button", { name: "Close export destinations" });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe("hidden");

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Last action" }));
    await user.tab();
    expect(document.activeElement).toBe(close);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Export playlists" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("closes only when the backdrop itself is clicked", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open exports" }));

    const dialog = screen.getByRole("dialog", { name: "Export playlists" });
    await user.click(dialog);
    expect(document.body.contains(dialog)).toBe(true);

    const backdrop = dialog.parentElement;
    expect(backdrop).not.toBeNull();
    if (backdrop) await user.click(backdrop);
    expect(screen.queryByRole("dialog", { name: "Export playlists" })).toBeNull();
  });
});
