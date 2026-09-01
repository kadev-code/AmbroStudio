import { describe, expect, it } from 'vitest';
import {
  createPricingMaterial,
  updatePricingMaterial,
} from '../../domain/pricing/material';
import { DEFAULT_PRICING_FORM } from './pricing-form-state';
import {
  parsePricingProductDrafts,
  pricingProductMaterialsCostCents,
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
    expect(updated[0].versions.map(({ versionNumber }) => versionNumber)).toEqual([
      2,
      1,
    ]);
    expect(updated[0].versions[1].form.marginPercent).toBe(35);
  });

  it('restaura somente listas válidas', () => {
    expect(parsePricingProductDrafts('[{"name":"incompleto"}]')).toEqual([]);
    expect(parsePricingProductDrafts('json inválido')).toEqual([]);
  });

  it('migra o custo manual de produtos antigos sem alterar o preço', () => {
    const legacy = JSON.stringify([
      {
        id: 'ef790ce3-90b6-4e0f-b349-baa6f15025b7',
        name: 'Kit festa antigo',
        form: {
          materials: 18.5,
          laborHour: 24,
          fixedHour: 12,
          minutes: 30,
          packaging: 1,
          wastePercent: 5,
          marginPercent: 40,
          taxPercent: 6,
          channelPercent: 5,
        },
        updatedAt: '2026-08-25T10:00:00.000Z',
      },
    ]);

    const [draft] = parsePricingProductDrafts(legacy);
    expect(draft.materialUsages).toEqual([]);
    expect(draft.sheetUsage).toBeNull();
    expect(draft.legacyMaterialsCostCents).toBe(1_850);
    expect(draft.form).toMatchObject({
      referenceQuantity: 1,
      minimumResaleQuantity: 10,
      commercialUnit: 'unidade',
      packaging: 1,
    });
    expect(draft.versions).toHaveLength(1);
    expect(draft.versions[0].calculationRuleVersion).toBe('legacy-import-v1');
  });

  it('mantém uma receita diferente por produto e atualiza seu custo', () => {
    const [material] = createPricingMaterial(
      [],
      {
        description: 'Cola branca',
        purchasePriceCents: 1_000,
        purchasedQuantity: 200,
        measurementUnit: 'ml',
        purchaseUrl: '',
        notes: '',
      },
      { id: '03c9eaa2-56db-4415-8c12-8e40d38f791c' },
    );
    const drafts = savePricingProductDraft([], {
      id: 'ef790ce3-90b6-4e0f-b349-baa6f15025b7',
      name: 'Kit festa',
      materialUsages: [{ materialId: material.id, usedQuantity: 15 }],
      legacyMaterialsCostCents: null,
      materials: [material],
      form: { ...DEFAULT_PRICING_FORM, materials: 0.75 },
      updatedAt: '2026-08-25T10:00:00.000Z',
    });
    const repricedMaterials = updatePricingMaterial(
      [material],
      material.id,
      {
        description: material.description,
        purchasePriceCents: 2_000,
        purchasedQuantity: material.purchasedQuantity,
        measurementUnit: material.measurementUnit,
        purchaseUrl: material.purchaseUrl,
        notes: material.notes,
      },
      '2026-08-26T10:00:00.000Z',
    );

    expect(pricingProductMaterialsCostCents(drafts[0], repricedMaterials)).toBe(150);
    expect(drafts[0].form.materials).toBe(0.75);
    expect(drafts[0].versions[0].results.unit.materialsCostCents).toBe(75);
    expect(drafts[0].materialUsages).toEqual([
      { materialId: material.id, usedQuantity: 15 },
    ]);

    const recalculated = savePricingProductDraft(drafts, {
      id: drafts[0].id,
      name: drafts[0].name,
      form: { ...drafts[0].form, materials: 1.5 },
      materialUsages: drafts[0].materialUsages,
      legacyMaterialsCostCents: null,
      materials: repricedMaterials,
      updatedAt: '2026-08-26T11:00:00.000Z',
    });
    expect(recalculated[0].versions[0].results.unit.materialsCostCents).toBe(150);
    expect(recalculated[0].versions[1].results.unit.materialsCostCents).toBe(75);
  });

  it('calcula o preço sugerido salvo no produto', () => {
    const drafts = savePricingProductDraft([], {
      id: 'ef790ce3-90b6-4e0f-b349-baa6f15025b7',
      name: 'Kit festa',
      form: { ...DEFAULT_PRICING_FORM, materials: 8 },
      updatedAt: '2026-08-25T10:00:00.000Z',
    });

    expect(suggestedPriceForProductDraft(drafts[0])).toBe(5572);
  });

  it('salva e restaura quantidade, unidade comercial e configuração A4', () => {
    const [paper] = createPricingMaterial(
      [],
      {
        description: 'Papel A4',
        purchasePriceCents: 5_000,
        purchasedQuantity: 100,
        measurementUnit: 'folha',
        purchaseUrl: '',
        notes: '',
      },
      { id: '03c9eaa2-56db-4415-8c12-8e40d38f791c' },
    );
    const drafts = savePricingProductDraft([], {
      id: 'ef790ce3-90b6-4e0f-b349-baa6f15025b7',
      name: 'Tag A4',
      form: {
        ...DEFAULT_PRICING_FORM,
        referenceQuantity: 50,
        minimumResaleQuantity: 20,
        commercialUnit: 'kit',
      },
      sheetUsage: {
        materialId: paper.id,
        itemWidthCm: 10,
        itemHeightCm: 10,
      },
      materials: [paper],
      updatedAt: '2026-09-01T10:00:00.000Z',
    });

    const [restored] = parsePricingProductDrafts(JSON.stringify(drafts));
    expect(restored.form.referenceQuantity).toBe(50);
    expect(restored.form.minimumResaleQuantity).toBe(20);
    expect(restored.form.commercialUnit).toBe('kit');
    expect(restored.sheetUsage).toEqual(drafts[0].sheetUsage);
    expect(restored.versions[0].results.reference.sheetsNeeded).toBe(13);
    expect(restored.versions[0].materials[0].notes).toBe('');
  });
});
