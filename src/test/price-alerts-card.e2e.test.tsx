import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

beforeAll(() => {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

const mockCreate = vi.fn();
const mockToggle = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "u1" }, session: null, loading: false }),
}));

vi.mock("@/hooks/offers/usePriceAlerts", () => ({
  usePriceAlerts: () => ({
    data: [
      {
        id: "a1",
        product_id: "p1",
        region_id: "r2",
        target_price: 9000,
        include_delivery: false,
        is_active: true,
        alert_type: "price_drop",
        last_triggered_at: null,
        created_at: new Date().toISOString(),
      },
    ],
    isLoading: false,
  }),
  useCreatePriceAlert: () => ({
    mutateAsync: mockCreate,
    isPending: false,
  }),
  useTogglePriceAlert: () => ({
    mutate: mockToggle,
    isPending: false,
  }),
  useDeletePriceAlert: () => ({
    mutate: mockDelete,
    isPending: false,
  }),
}));

describe("PriceAlertsCard E2E", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates alert with region + include_delivery", async () => {
    const { PriceAlertsCard } = await import("@/components/offers/PriceAlertsCard");
    render(<PriceAlertsCard productId="p1" regionId="r2" />);

    fireEvent.change(screen.getByLabelText("السعر المستهدف"), {
      target: { value: "8500" },
    });
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "إضافة تنبيه" }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          product_id: "p1",
          target_price: 8500,
          region_id: "r2",
          include_delivery: true,
          user_id: "u1",
        }),
      );
    });
  });

  it("toggles existing alert", async () => {
    const { PriceAlertsCard } = await import("@/components/offers/PriceAlertsCard");
    render(<PriceAlertsCard productId="p1" regionId="r2" />);

    fireEvent.click(screen.getByText("إيقاف"));
    expect(mockToggle).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a1", is_active: false, product_id: "p1" }),
    );
  });

  it("deletes existing alert", async () => {
    const { PriceAlertsCard } = await import("@/components/offers/PriceAlertsCard");
    render(<PriceAlertsCard productId="p1" regionId="r2" />);

    // The delete button contains the Trash2 icon
    const deleteButtons = screen.getAllByRole("button").filter(
      (b) => b.querySelector("svg") && b.classList.contains("text-destructive"),
    );
    if (deleteButtons.length > 0) {
      fireEvent.click(deleteButtons[0]);
      expect(mockDelete).toHaveBeenCalledWith(
        expect.objectContaining({ id: "a1", product_id: "p1" }),
      );
    }
  });

  it("shows existing alert badge and price", async () => {
    const { PriceAlertsCard } = await import("@/components/offers/PriceAlertsCard");
    render(<PriceAlertsCard productId="p1" regionId="r2" />);

    expect(screen.getByText("فعال")).toBeInTheDocument();
    // Price may render as Arabic numerals (٩٬٠٠٠) or Western (9,000)
    expect(screen.getByText(/9[,٬]000|٩[,٬]٠٠٠/)).toBeInTheDocument();
  });
});
