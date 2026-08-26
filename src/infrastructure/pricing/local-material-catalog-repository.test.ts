import { describe, expect, it } from 'vitest';
import { createPricingMaterial } from '../../domain/pricing/material';
import { parseStoredPricingMaterials } from './local-material-catalog-repository';

describe('local material catalog repository', () => {
  it('restaura somente catálogos válidos', () => {
    const materials = createPricingMaterial(
      [],
      {
        description: 'Papel fotográfico',
        purchasePriceCents: 5_000,
        purchasedQuantity: 100,
        measurementUnit: 'folha',
        purchaseUrl: '',
        notes: '',
      },
      {
        id: '4e5706ab-61d4-42f4-b90c-daa88b34d29f',
        timestamp: '2026-08-26T10:00:00.000Z',
      },
    );

    expect(parseStoredPricingMaterials(JSON.stringify(materials))).toEqual(
      materials,
    );
    expect(parseStoredPricingMaterials('[{"description":"incompleto"}]')).toEqual(
      [],
    );
  });
});
