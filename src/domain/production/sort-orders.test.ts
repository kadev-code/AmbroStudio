import { describe, expect, it } from 'vitest';
import { sortProductionQueue } from './sort-orders';

describe('sortProductionQueue', () => {
  const now = new Date('2026-08-25T12:00:00-03:00');

  it('coloca atrasados antes das demais prioridades', () => {
    const result = sortProductionQueue(
      [
        { id: 'normal', dueDate: '2026-08-30', priority: 'normal', manualRank: 0 },
        { id: 'late', dueDate: '2026-08-24', priority: 'low', manualRank: 0 },
      ],
      now,
    );

    expect(result.map((item) => item.id)).toEqual(['late', 'normal']);
  });

  it('ordena prioridade e depois a entrega mais próxima', () => {
    const result = sortProductionQueue(
      [
        { id: 'normal', dueDate: '2026-08-26', priority: 'normal', manualRank: 0 },
        { id: 'high-later', dueDate: '2026-08-29', priority: 'high', manualRank: 0 },
        { id: 'high-sooner', dueDate: '2026-08-27', priority: 'high', manualRank: 0 },
      ],
      now,
    );

    expect(result.map((item) => item.id)).toEqual([
      'high-sooner',
      'high-later',
      'normal',
    ]);
  });
});
