export type ProductionPriority = 'urgent' | 'high' | 'normal' | 'low';

export type ProductionQueueItem = {
  id: string;
  dueDate: string;
  priority: ProductionPriority;
  manualRank: number;
};

const priorityWeight: Record<ProductionPriority, number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function localDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

export function sortProductionQueue<T extends ProductionQueueItem>(
  items: readonly T[],
  now = new Date(),
) {
  const today = startOfDay(now);

  return [...items].sort((left, right) => {
    const leftDue = startOfDay(localDate(left.dueDate));
    const rightDue = startOfDay(localDate(right.dueDate));
    const leftOverdue = leftDue < today;
    const rightOverdue = rightDue < today;

    if (leftOverdue !== rightOverdue) {
      return leftOverdue ? -1 : 1;
    }

    const priorityDifference =
      priorityWeight[left.priority] - priorityWeight[right.priority];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    if (left.manualRank !== right.manualRank) {
      return left.manualRank - right.manualRank;
    }

    return left.id.localeCompare(right.id);
  });
}
