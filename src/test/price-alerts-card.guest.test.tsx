import React from "react";
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";

beforeAll(() => {
  (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

vi.mock("@/hooks/offers/usePriceAlerts", () => ({
  usePriceAlerts: () => ({ data: [], isLoading: false }),
  useCreatePriceAlert: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTogglePriceAlert: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePriceAlert: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe("PriceAlertsCard guest", () => {
  it("shows login hint for unauthenticated user", async () => {
    const { PriceAlertsCard } = await import("@/components/offers/PriceAlertsCard");
    render(<PriceAlertsCard productId="p1" regionId={null} />);
    expect(screen.getByText("سجّل دخولك لإنشاء تنبيهات أسعار")).toBeInTheDocument();
  });

  it("does not show create form", async () => {
    const { PriceAlertsCard } = await import("@/components/offers/PriceAlertsCard");
    render(<PriceAlertsCard productId="p1" regionId={null} />);
    expect(screen.queryByLabelText("السعر المستهدف")).not.toBeInTheDocument();
  });
});
