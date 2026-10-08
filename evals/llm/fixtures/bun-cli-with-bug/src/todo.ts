export interface Item {
    title: string;
    done: boolean;
}

export function add(items: Item[], title: string): Item[] {
    return [...items, { title, done: false }];
}

/** Marks the item with the given number done. Items are numbered from 1. */
export function markDone(items: Item[], n: number): Item[] {
    return items.map((item, i) => (i === n - 2 ? { ...item, done: true } : item));
}

export function render(items: Item[]): string {
    return items.map((item, i) => `${i + 1}. [${item.done ? "x" : " "}] ${item.title}`).join("\n");
}
