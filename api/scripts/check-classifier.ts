import { inferCategoryKeyDetailed } from '../src/ingestion/categoryInfer';

type Case = {
  name: string;
  input: { name?: string; description?: string; siteCategory?: string; domain?: string; url?: string };
  expect: string;
};

const cases: Case[] = [
  {
    name: 'cat food should not stay groceries',
    input: { name: 'Cat Food Salmon 2kg', siteCategory: 'groceries/snacks', domain: 'example.com' },
    expect: 'essentials',
  },
  {
    name: 'micellar water should map to beauty',
    input: { name: 'Micellar Water 400ml', siteCategory: 'beverages/drinks', domain: 'example.com' },
    expect: 'beauty',
  },
  {
    name: 'ps4 game should map electronics',
    input: { name: 'PS4 Game CD', siteCategory: 'fashion/wallets', domain: 'example.com' },
    expect: 'electronics',
  },
  {
    name: 'leather wallet stays clothing',
    input: { name: 'Leather Wallet Brown', siteCategory: 'fashion/wallets', domain: 'example.com' },
    expect: 'clothing',
  },
];

let passed = 0;
for (const c of cases) {
  const got = inferCategoryKeyDetailed(c.input).category;
  if (got !== c.expect) {
    console.error(`FAIL: ${c.name} => got ${got}, expected ${c.expect}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS: ${c.name} => ${got}`);
  }
}
if (!process.exitCode) console.log(`classifier harness passed: ${passed}/${cases.length}`);
