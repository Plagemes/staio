import { getDb, type ProductRecord } from "./db";

export async function getProductRecord(
  barcode: string,
): Promise<ProductRecord | undefined> {
  return getDb().products.get(barcode);
}

export async function putProductRecord(record: ProductRecord): Promise<void> {
  await getDb().products.put({
    barcode: record.barcode,
    fetchedAt: record.fetchedAt,
    data: record.data,
  });
}

export async function listProductRecords(): Promise<ProductRecord[]> {
  return getDb().products.toArray();
}

export async function deleteProductRecord(barcode: string): Promise<void> {
  await getDb().products.delete(barcode);
}
