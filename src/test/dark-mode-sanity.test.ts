/**
 * Dark mode sanity — verify pages use semantic theme tokens only.
 */

import { describe, it, expect } from 'vitest';

// Static raw imports for page files
import indexPage from '../../src/pages/Index.tsx?raw';
import pricesPage from '../../src/pages/Prices.tsx?raw';
import dashboardPage from '../../src/pages/Dashboard.tsx?raw';
import reportPricePage from '../../src/pages/ReportPrice.tsx?raw';
import signInPage from '../../src/pages/SignIn.tsx?raw';
import signUpPage from '../../src/pages/SignUp.tsx?raw';
import productDetailsPage from '../../src/pages/ProductDetails.tsx?raw';
import notFoundPage from '../../src/pages/NotFound.tsx?raw';
import appNavbar from '../../src/components/AppNavbar.tsx?raw';

const HARDCODED_COLOR_PATTERNS = [
  /\bbg-white\b/,
  /\bbg-black\b/,
  /\btext-white\b/,
  /\btext-black\b/,
  /\bbg-gray-\d/,
  /\btext-gray-\d/,
  /\bborder-gray-\d/,
  /\bbg-slate-\d/,
  /\btext-slate-\d/,
];

const pages: [string, string][] = [
  ['Index.tsx', indexPage],
  ['Prices.tsx', pricesPage],
  ['Dashboard.tsx', dashboardPage],
  ['ReportPrice.tsx', reportPricePage],
  ['SignIn.tsx', signInPage],
  ['SignUp.tsx', signUpPage],
  ['ProductDetails.tsx', productDetailsPage],
  ['NotFound.tsx', notFoundPage],
];

describe('Dark mode — no hardcoded colors in pages', () => {
  pages.forEach(([name, content]) => {
    it(`${name} uses only semantic tokens`, () => {
      for (const pattern of HARDCODED_COLOR_PATTERNS) {
        const match = content.match(pattern);
        expect(match, `Found hardcoded color "${match?.[0]}" in ${name}`).toBeNull();
      }
    });
  });
});

describe('Dark mode — navbar theme toggle', () => {
  it('AppNavbar has theme-toggle data-testid and useTheme', () => {
    expect(appNavbar).toContain('data-testid="theme-toggle"');
    expect(appNavbar).toContain('useTheme');
  });
});
