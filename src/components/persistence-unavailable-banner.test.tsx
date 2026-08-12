import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PersistenceUnavailableBanner } from "@/components/persistence-unavailable-banner";

afterEach(() => {
  cleanup();
});

describe("PersistenceUnavailableBanner", () => {
  it("exposes a persistent named region and backup action", () => {
    const onDownloadBackup = vi.fn();
    render(<PersistenceUnavailableBanner onDownloadBackup={onDownloadBackup} />);

    const region = screen.getByRole("region", {
      name: "Browser saving is unavailable",
    });
    expect(region).toHaveAccessibleDescription(
      "RubricTrail cannot safely write this project in this browser. New changes remain only in this tab. Download a backup before refreshing or closing this tab. Keep the JSON file private because it can contain notes and short excerpts.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser saving is unavailable. Download a project backup before closing this tab.",
    );
    expect(
      within(region).queryByRole("button", { name: /dismiss|close/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(region).getByRole("button", { name: "Download project backup" }),
    );
    expect(onDownloadBackup).toHaveBeenCalledOnce();
  });
});
