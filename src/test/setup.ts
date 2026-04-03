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

const suppressedWarnings = [
  "React Router Future Flag Warning",
  "The width(0) and height(0) of chart should be greater than 0",
];

const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

function shouldSuppressConsoleMessage(args: unknown[]) {
  const firstArg = typeof args[0] === "string" ? args[0] : "";
  return suppressedWarnings.some((message) => firstArg.includes(message));
}

console.warn = (...args: Parameters<typeof console.warn>) => {
  if (shouldSuppressConsoleMessage(args)) {
    return;
  }

  originalConsoleWarn(...args);
};

console.error = (...args: Parameters<typeof console.error>) => {
  if (shouldSuppressConsoleMessage(args)) {
    return;
  }

  originalConsoleError(...args);
};

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
