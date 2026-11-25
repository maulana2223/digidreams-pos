import { getMenuAndCategories } from "@/app/actions/pos";
import PosClient from "@/app/components/PosClient";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { categories, products } = await getMenuAndCategories();

  return (
    <PosClient
      initialCategories={categories}
      initialProducts={products}
    />
  );
}