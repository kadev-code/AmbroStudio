import { describe, expect, it } from 'vitest';
import {
  createPricingMaterial,
  materialUsageCostCents,
  materialUsagesCostCents,
  setPricingMaterialArchived,
  updatePricingMaterial,
} from './material';

const materialInput = {
  description: 'Cola branca',
  purchasePriceCents: 1_000,
  purchasedQuantity: 200,
  measurementUnit: 'ml' as const,
  purchaseUrl: 'https://example.com/cola',
  notes: 'Uso geral',
};

describe('pricing material', () => {
  it('calcula o custo proporcional sem arredondar antes do subtotal', () => {
    const [material] = createPricingMaterial([], materialInput, {
      id: '03c9eaa2-56db-4415-8c12-8e40d38f791c',
      timestamp: '2026-08-26T10:00:00.000Z',
    });

    expect(materialUsageCostCents(material, 15)).toBe(75);
    expect(
      materialUsagesCostCents(
        [{ materialId: material.id, usedQuantity: 15 }],
        [material],
      ),
    ).toBe(75);
  });

  it('edita e arquiva sem trocar o identificador', () => {
    const [material] = createPricingMaterial([], materialInput, {
      id: '03c9eaa2-56db-4415-8c12-8e40d38f791c',
      timestamp: '2026-08-26T10:00:00.000Z',
    });
    const edited = updatePricingMaterial(
      [material],
      material.id,
      { ...materialInput, purchasePriceCents: 1_200 },
      '2026-08-26T11:00:00.000Z',
    );
    const archived = setPricingMaterialArchived(
      edited,
      material.id,
      true,
      '2026-08-26T12:00:00.000Z',
    );

    expect(archived[0].id).toBe(material.id);
    expect(archived[0].purchasePriceCents).toBe(1_200);
    expect(archived[0].archived).toBe(true);
  });

  it('recusa link sem HTTPS e quantidades duplicadas', () => {
    expect(() =>
      createPricingMaterial([], {
        ...materialInput,
        purchaseUrl: 'http://example.com/cola',
      }),
    ).toThrow();

    const [material] = createPricingMaterial([], materialInput, {
      id: '03c9eaa2-56db-4415-8c12-8e40d38f791c',
    });
    expect(() =>
      materialUsagesCostCents(
        [
          { materialId: material.id, usedQuantity: 1 },
          { materialId: material.id, usedQuantity: 2 },
        ],
        [material],
      ),
    ).toThrow('DUPLICATED_MATERIAL_USAGE');
  });

  it('impede materiais duplicados sem bloquear a edição do mesmo cadastro', () => {
    const [material] = createPricingMaterial([], materialInput, {
      id: '03c9eaa2-56db-4415-8c12-8e40d38f791c',
    });

    expect(() =>
      createPricingMaterial([material], {
        ...materialInput,
        description: '  COLA BRANCA  ',
      }),
    ).toThrow('DUPLICATED_MATERIAL_DESCRIPTION');

    expect(() =>
      updatePricingMaterial([material], material.id, {
        ...materialInput,
        description: 'Cola branca',
        notes: 'Cadastro atualizado',
      }),
    ).not.toThrow();
  });
});
