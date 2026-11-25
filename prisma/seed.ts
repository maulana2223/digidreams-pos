import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? "file:./dev.db",
});
const prisma = new PrismaClient({ adapter });
async function main() {
  // Bersihkan data lama agar seed aman dijalankan berkali-kali
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.promo.deleteMany();

  // 1. Buat 4 Kategori
  const coffee = await prisma.category.create({ data: { name: "Coffee" } });
  const nonCoffee = await prisma.category.create({ data: { name: "Non-Coffee" } });
  const food = await prisma.category.create({ data: { name: "Food & Snacks" } });
  const workspace = await prisma.category.create({ data: { name: "Workspace Pass" } });

  // 2. Buat 8 Produk (1 produk stok 0 untuk uji validasi stok habis)
  await prisma.product.createMany({
    data: [
      {
        name: "DigiDreams Signature Aren Latte",
        categoryId: coffee.id,
        price: 28000,
        stock: 25,
      },
      {
        name: "Americano Iced",
        categoryId: coffee.id,
        price: 22000,
        stock: 30,
      },
      {
        name: "Caramel Macchiato",
        categoryId: coffee.id,
        price: 32000,
        stock: 15,
      },
      {
        name: "Matcha Oat Latte",
        categoryId: nonCoffee.id,
        price: 34000,
        stock: 12,
      },
      {
        name: "Artisan Chocolate Iced",
        categoryId: nonCoffee.id,
        price: 29000,
        stock: 18,
      },
      {
        name: "Butter Croissant",
        categoryId: food.id,
        price: 25000,
        stock: 10,
      },
      {
        name: "Truffle French Fries",
        categoryId: food.id,
        price: 30000,
        stock: 0,
      },
      {
        name: "Full-Day Coworking Pass",
        categoryId: workspace.id,
        price: 75000,
        stock: 20,
      },
    ],
  });

  // 3. Buat Promo DIGIZEN10 & HEMAT15K
  await prisma.promo.createMany({
    data: [
      {
        code: "DIGIZEN10",
        type: "PERCENT",
        value: 10,
        minOrder: 50000,
        isActive: true,
      },
      {
        code: "HEMAT15K",
        type: "FIXED",
        value: 15000,
        minOrder: 80000,
        isActive: true,
      },
    ],
  });

  console.log("Seeding database DigiDreams POS selesai!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });