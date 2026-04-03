import { describe, expect, it } from 'vitest';
import { classifyGovernedTaxonomy } from './taxonomyGovernance';

describe('taxonomyGovernance', () => {
  it('forces pet products away from groceries', () => {
    const decision = classifyGovernedTaxonomy({
      name: 'Royal Canin Cat Food 2kg',
      description: 'Dry pet food for adult cats',
      siteCategoryRaw: 'groceries',
      domain: 'example.com',
    });

    expect(decision.taxonomyKey).toBe('essentials/pets');
    expect(decision.category).toBe('essentials');
    expect(decision.status).toBe('approved');
    expect(decision.forcedByRule).toBe('pet_products_not_food');
  });

  it('forces playing cards away from food branches', () => {
    const decision = classifyGovernedTaxonomy({
      name: 'UNO Playing Cards Deck',
      description: 'Family card game',
      siteCategoryRaw: 'food',
      domain: 'market.example',
    });

    expect(decision.taxonomyKey).toBe('toys/general');
    expect(decision.category).toBe('toys');
    expect(decision.status).toBe('approved');
  });

  it('forces engine oil away from cooking oils', () => {
    const decision = classifyGovernedTaxonomy({
      name: 'Castrol 5W-30 Engine Oil 4L',
      description: 'Fully synthetic motor oil',
      siteCategoryRaw: 'grocery oils',
      domain: 'auto.example',
    });

    expect(decision.taxonomyKey).toBe('automotive/oils/engine');
    expect(decision.category).toBe('automotive');
    expect(decision.status).toBe('approved');
  });

  it('keeps beverages in the beverages branch', () => {
    const decision = classifyGovernedTaxonomy({
      name: 'Pepsi 6 x 330ml',
      description: 'Soft drink multipack',
      siteCategoryRaw: 'drinks',
      domain: 'grocery.example',
    });

    expect(decision.taxonomyKey).toBe('groceries/beverages');
    expect(decision.category).toBe('beverages');
    expect(decision.status).toBe('approved');
  });

  it('quarantines weak ambiguous items instead of publishing junk', () => {
    const decision = classifyGovernedTaxonomy({
      name: 'Premium Card',
      description: 'Special item',
      siteCategoryRaw: 'groceries',
      domain: 'mixed.example',
    });

    expect(decision.status).toBe('quarantined');
    expect(decision.confidence).toBeLessThan(0.88);
  });
});
