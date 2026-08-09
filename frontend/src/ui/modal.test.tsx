import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Modal } from "./modal.tsx";

describe("Modal", () => {
  it("keeps Tab on the panel when every control is disabled", () => {
    render(
      <>
        <button>Behind the modal</button>
        <Modal labelledBy="modal-title">
          <h2 id="modal-title">Reconnect required</h2>
          <button disabled>Confirm</button>
          <button disabled>Leave</button>
        </Modal>
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Reconnect required" });
    expect(dialog).toHaveFocus();

    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(dialog).toHaveFocus();
  });
});
