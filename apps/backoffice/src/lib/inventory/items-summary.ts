// Stock › Ingredients / Perishables key numbers (restructure step 6, 17 Nov
// 2026), from the item list the page already loads. "Ad-hoc Purchase" is the
// placeholder supplier for one-off buys, so it does not count as a supplier.

export type ItemRow = {
  group: string;
  checkFrequency: string;
  shelfLifeDays: number | null;
  suppliers: { name: string }[];
};

export function summariseItems(items: ItemRow[]) {
  const sellers = (i: ItemRow) => i.suppliers.filter((s) => s.name !== "Ad-hoc Purchase").length;
  return {
    total: items.length,
    groups: new Set(items.map((i) => i.group)).size,
    noSupplier: items.filter((i) => sellers(i) === 0).length,
    oneSupplier: items.filter((i) => sellers(i) === 1).length,
    daily: items.filter((i) => i.checkFrequency === "DAILY").length,
    weekly: items.filter((i) => i.checkFrequency === "WEEKLY").length,
    noShelfLife: items.filter((i) => !i.shelfLifeDays).length,
  };
}
