import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICING_FORM,
  parsePricingDraft,
} from './pricing-form-state';

describe('pricing form draft', () => {
  it('restaura o último rascunho válido', () => {
    const draft = { ...DEFAULT_PRICING_FORM, materials: 37.45, minutes: 75 };

    expect(parsePricingDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it('usa os padrões quando o rascunho está corrompido', () => {
    expect(parsePricingDraft('{rascunho-invalido')).toEqual(
      DEFAULT_PRICING_FORM,
    );
  });

  it('não aceita campos ausentes ou valores não numéricos', () => {
    expect(parsePricingDraft(JSON.stringify({ materials: '10' }))).toEqual(
      DEFAULT_PRICING_FORM,
    );
  });
});
