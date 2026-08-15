import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "@/app/page";

describe("HomePage", () => {
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
