import { inferCategoryKeyDetailed } from '../src/ingestion/categoryInfer';

type Product = {
  id: string;
  name: string;
  siteCategory?: string;
  category: string;
  site: string;
  textScore: number;
  classificationStatus: 'classified' | 'needs_review';
  categoryConflict: boolean;
};

type Conflict = {
  id: string;
  productId: string;
  status: 'open' | 'resolved' | 'ignored';
  decidedCategory?: string | null;
  note?: string | null;
};

function classifyProduct(id: string, name: string, siteCategory?: string): Product {
  const result = inferCategoryKeyDetailed({ name, siteCategory, domain: 'example.com' });
  const hasConflict = result.site !== 'general' && result.site !== result.category;
  return {
    id,
    name,
    siteCategory,
    category: result.category,
    site: result.site,
    textScore: result.textScore,
    classificationStatus: hasConflict ? 'needs_review' : 'classified',
    categoryConflict: hasConflict,
  };
}

function createConflict(product: Product): Conflict | null {
  if (!product.categoryConflict) return null;
  return {
    id: `cc_${product.id}`,
    productId: product.id,
    status: 'open',
    decidedCategory: null,
    note: 'auto-detected conflict',
  };
}

function visibleProducts(products: Product[], conflicts: Conflict[]): Product[] {
  const openIds = new Set(conflicts.filter((c) => c.status === 'open').map((c) => c.productId));
  return products.filter((p) => !openIds.has(p.id));
}

function reviewConflict(
  product: Product,
  conflict: Conflict,
  payload: { status: 'resolved' | 'ignored' | 'open'; decidedCategory?: string; applyToProduct?: boolean },
) {
  conflict.status = payload.status;
  conflict.decidedCategory = payload.decidedCategory ?? conflict.decidedCategory ?? null;
  if (payload.applyToProduct && payload.decidedCategory) {
    product.category = payload.decidedCategory;
    product.classificationStatus = 'classified';
    product.categoryConflict = false;
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function main() {
  const products = [
    classifyProduct('p1', 'Cat Food Salmon 2kg', 'groceries/snacks'),
    classifyProduct('p2', 'Leather Wallet Brown', 'fashion/wallets'),
    classifyProduct('p3', 'PlayStation 4 Game CD', 'fashion/wallets'),
  ];

  const conflicts = products.map(createConflict).filter(Boolean) as Conflict[];

  const p1 = products.find((p) => p.id === 'p1')!;
  const p2 = products.find((p) => p.id === 'p2')!;
  const p3 = products.find((p) => p.id === 'p3')!;

  assert(p1.category === 'essentials', 'cat food should classify to essentials');
  assert(p1.classificationStatus === 'needs_review', 'cat food should require review');
  assert(p2.category === 'clothing', 'wallet should remain clothing');
  assert(p2.classificationStatus === 'classified', 'wallet should stay classified');
  assert(p3.category === 'electronics', 'PS4 game should classify to electronics');
  assert(p3.classificationStatus === 'needs_review', 'PS4 game should require review');

  const initiallyVisible = visibleProducts(products, conflicts);
  assert(initiallyVisible.some((p) => p.id === 'p2'), 'wallet should remain visible');
  assert(!initiallyVisible.some((p) => p.id === 'p1'), 'cat food conflict should be excluded from explore');
  assert(!initiallyVisible.some((p) => p.id === 'p3'), 'PS4 conflict should be excluded from explore');

  const p1Conflict = conflicts.find((c) => c.productId === 'p1')!;
  reviewConflict(p1, p1Conflict, { status: 'resolved', decidedCategory: 'essentials', applyToProduct: true });

  const afterP1Review = visibleProducts(products, conflicts);
  assert(afterP1Review.some((p) => p.id === 'p1'), 'resolved cat food should return to explore');
  assert(afterP1Review.find((p) => p.id === 'p1')?.category === 'essentials', 'resolved cat food category should persist');

  const p3Conflict = conflicts.find((c) => c.productId === 'p3')!;
  reviewConflict(p3, p3Conflict, { status: 'ignored' });
  const afterIgnore = visibleProducts(products, conflicts);
  assert(afterIgnore.some((p) => p.id === 'p3'), 'ignored conflict should restore product to explore');

  console.log('governance e2e harness passed');
}

main();
