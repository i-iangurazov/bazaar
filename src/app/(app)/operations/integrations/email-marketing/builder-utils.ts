export type BuilderBlockBase = {
  id: string;
  type: string;
  [key: string]: unknown;
};

export const insertBuilderBlock = <T extends BuilderBlockBase>(
  blocks: T[],
  block: T,
  index?: number,
) => {
  const next = [...blocks];
  const safeIndex =
    index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
  next.splice(safeIndex, 0, block);
  return next;
};

export const updateBuilderBlock = <T extends BuilderBlockBase>(
  blocks: T[],
  id: string,
  patch: Partial<T>,
) => blocks.map((block) => (block.id === id ? ({ ...block, ...patch } as T) : block));

export const deleteBuilderBlock = <T extends BuilderBlockBase>(blocks: T[], id: string) =>
  blocks.filter((block) => block.id !== id);

export const duplicateBuilderBlock = <T extends BuilderBlockBase>(
  blocks: T[],
  id: string,
  createId: (block: T) => string,
) => {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0) {
    return { blocks, duplicated: null as T | null };
  }
  const duplicated = { ...blocks[index], id: createId(blocks[index]) } as T;
  const next = [...blocks];
  next.splice(index + 1, 0, duplicated);
  return { blocks: next, duplicated };
};

export const moveBuilderBlock = <T extends BuilderBlockBase>(
  blocks: T[],
  id: string,
  direction: -1 | 1,
) => {
  const index = blocks.findIndex((block) => block.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= blocks.length) {
    return blocks;
  }
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  next.splice(nextIndex, 0, moved);
  return next;
};

export const reorderBuilderBlocks = <T extends BuilderBlockBase>(
  blocks: T[],
  activeId: string,
  overId: string,
) => {
  if (activeId === overId) {
    return blocks;
  }
  const oldIndex = blocks.findIndex((block) => block.id === activeId);
  const newIndex = blocks.findIndex((block) => block.id === overId);
  if (oldIndex < 0 || newIndex < 0) {
    return blocks;
  }
  const next = [...blocks];
  const [moved] = next.splice(oldIndex, 1);
  next.splice(newIndex, 0, moved);
  return next;
};

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

export const builderBlockHasMeaningfulContent = (block: BuilderBlockBase) => {
  if (block.type === "divider") {
    return false;
  }
  if (block.type === "products") {
    return Array.isArray(block.productIds) && block.productIds.length > 0;
  }
  return [
    block.heading,
    block.subtitle,
    block.body,
    block.text,
    block.buttonText,
    block.imageUrl,
    block.title,
    block.discountCode,
    block.description,
    block.expiryText,
    block.storeName,
    block.phone,
    block.address,
    block.unsubscribeText,
  ].some(hasText);
};
