import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("states Relay's exact reliability promise", () => {
    render(<HomePage />);

    expect(screen.getByText("Event assurance, powered by local closets")).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Relay is the reliability layer for time-sensitive fashion.",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Discovery apps show possibilities; Relay makes sure you have something to wear.",
      ),
    ).toBeVisible();
  });

  it("offers distinct shopper and provider entry points", () => {
    render(<HomePage />);

    expect(screen.getByRole("link", { name: "Shop as a guest" })).toHaveAttribute(
      "href",
      "/request/new",
    );
    expect(screen.getByRole("link", { name: "Supply your closet" })).toHaveAttribute(
      "href",
      "/provider",
    );
  });
});
