import "@testing-library/jest-dom";
import { vi } from "vitest";

vi.mock("@/integrations/dataMode", () => ({
  USE_API: false,
  USE_CLERK: false,
}));

vi.mock("@/hooks/auth/useIsAdmin", () => ({
  useIsAdmin: () => ({
    data: false,
    isLoading: false,
  }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: unknown }) => children,
  Tooltip: ({ children }: { children: unknown }) => children,
  TooltipTrigger: ({ children }: { children: unknown }) => children,
  TooltipContent: ({ children }: { children: unknown }) => children,
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
