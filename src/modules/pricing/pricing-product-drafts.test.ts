import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING_FORM } from './pricing-form-state';
import {
  parsePricingProductDrafts,
  savePricingProductDraft,
  suggestedPriceForProductDraft,
} from './pricing-product-drafts';

describe('pricing product drafts', () => {
  it('mantém uma configuração de custos e margem por produto', () => {
    const firstVersion = savePricingProductDraft([], {
      id: '8764a8b7-2510-47f1-b29f-512606736212',
      name: 'Kit festa',
      form: { ...DEFAULT_PRICING_FORM, marginPercent: 35 },
      updatedAt: '2026-08-25T10:00:00.000Z',
    });
    const updated = savePricingProductDraft(firstVersion, {
      id: firstVersion[0].id,
      name: 'Kit festa',
      form: { ...DEFAULT_PRICING_FORM, marginPercent: 48 },
      updatedAt: '2026-08-25T11:00:00.000Z',
    });

    expect(updated).toHaveLength(1);
    expect(updated[0].form.marginPercent).toBe(48);
  });

  it('restaura somente listas válidas', () => {
    expect(parsePricingProductDrafts('[{"name":"incompleto"}]')).toEqual([]);
    expect(parsePricingProductDrafts('json inválido')).toEqual([]);
  });

  it('calcula o preço sugerido salvo no produto', () => {
    const drafts = savePricingProductDraft([], {
      id: 'ef790ce3-90b6-4e0f-b349-baa6f15025b7',
      name: 'Kit festa',
      form: DEFAULT_PRICING_FORM,
      updatedAt: '2026-08-25T10:00:00.000Z',
    });

    expect(suggestedPriceForProductDraft(drafts[0])).toBe(5592);
  });
});
