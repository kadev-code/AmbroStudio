import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICING_FORM,
  parsePricingDraft,
  pricingFieldInputsFromForm,
  pricingNumberFromInput,
  updatePricingFormFromInput,
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

  it('permite que o texto do campo fique vazio sem recolocar zero', () => {
    const inputs = pricingFieldInputsFromForm(DEFAULT_PRICING_FORM);
    const updated = updatePricingFormFromInput(
      DEFAULT_PRICING_FORM,
      'laborHour',
      '',
    );

    expect(inputs.laborHour).toBe('24');
    expect(pricingNumberFromInput('')).toBe(0);
    expect(updated.laborHour).toBe(0);
  });

  it('interpreta vírgula decimal sem alterar o texto digitado', () => {
    const rawValue = '12,75';
    const updated = updatePricingFormFromInput(
      DEFAULT_PRICING_FORM,
      'fixedHour',
      rawValue,
    );

    expect(rawValue).toBe('12,75');
    expect(updated.fixedHour).toBe(12.75);
  });

  it('mantém o estado numérico seguro durante uma entrada incompleta', () => {
    expect(pricingNumberFromInput(',')).toBe(0);
    expect(pricingNumberFromInput('-')).toBe(0);
    expect(pricingNumberFromInput('valor inválido')).toBe(0);
  });

  it('permite apagar temporariamente uma quantidade sem travar o formulário', () => {
    const updated = updatePricingFormFromInput(
      DEFAULT_PRICING_FORM,
      'referenceQuantity',
      '',
    );

    expect(updated.referenceQuantity).toBe(1);
  });

  it('migra rascunhos antigos com os novos campos comerciais', () => {
    const legacy = {
      materials: 8,
      laborHour: 24,
      fixedHour: 12,
      minutes: 30,
      packaging: 1,
      wastePercent: 5,
      marginPercent: 40,
      taxPercent: 6,
      channelPercent: 5,
    };

    expect(parsePricingDraft(JSON.stringify(legacy))).toMatchObject({
      referenceQuantity: 1,
      minimumResaleQuantity: 10,
      commercialUnit: 'unidade',
      packaging: 1,
    });
  });
});
