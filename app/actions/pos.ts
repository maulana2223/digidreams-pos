"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function getMenuAndCategories(search?: string, categoryId?: number) {
  const [categories, products] = await Promise.all([
    prisma.category.findMany({
      orderBy: { id: "asc" },
    }),
    prisma.product.findMany({
      where: {
        ...(categoryId ? { categoryId } : {}),
        ...(search
          ? {
              name: {
                contains: search,
              },
            }
          : {}),
      },
      include: {
        category: true,
      },
      orderBy: { id: "asc" },
    }),
  ]);

  return { categories, products };
}

export async function validatePromoCode(code: string, subtotal: number) {
  const cleanCode = code.trim().toUpperCase();
  if (!cleanCode) {
    return { valid: false, message: "Masukkan kode promo terlebih dahulu." };
  }

  const promo = await prisma.promo.findUnique({
    where: { code: cleanCode },
  });

  if (!promo || !promo.isActive) {
    return { valid: false, message: "Kode promo tidak ditemukan atau tidak aktif." };
  }

  if (subtotal < promo.minOrder) {
    return {
      valid: false,
      message: `Minimal belanja Rp ${promo.minOrder.toLocaleString("id-ID")} untuk promo ini.`,
    };
  }

  const discountAmount =
    promo.type === "PERCENT"
      ? Math.floor((subtotal * promo.value) / 100)
      : Math.min(promo.value, subtotal);

  return {
    valid: true,
    message: `Promo ${promo.code} berhasil diterapkan!`,
    promo: {
      code: promo.code,
      type: promo.type,
      value: promo.value,
      discountAmount,
    },
  };
}

export interface CheckoutItemInput {
  productId: number;
  quantity: number;
}

export async function processCheckout(params: {
  items: CheckoutItemInput[];
  promoCode?: string;
  paymentMethod: "CASH" | "QRIS";
}) {
  const { items, promoCode, paymentMethod } = params;

  if (!items || items.length === 0) {
    return { success: false, message: "Keranjang masih kosong." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const productIds = items.map((i) => i.productId);
      const dbProducts = await tx.product.findMany({
        where: { id: { in: productIds } },
      });

      const productMap = new Map(dbProducts.map((p) => [p.id, p]));

      let subtotal = 0;
      const orderItemsData: {
        productId: number;
        productName: string;
        quantity: number;
        unitPrice: number;
        subtotal: number;
      }[] = [];

      for (const item of items) {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new Error(`Produk ID ${item.productId} tidak ditemukan.`);
        }
        if (item.quantity <= 0) {
          throw new Error(`Jumlah item ${product.name} tidak valid.`);
        }
        if (product.stock < item.quantity) {
          throw new Error(`Stok ${product.name} tidak mencukupi (sisa ${product.stock}).`);
        }

        const lineSubtotal = product.price * item.quantity;
        subtotal += lineSubtotal;

        orderItemsData.push({
          productId: product.id,
          productName: product.name,
          quantity: item.quantity,
          unitPrice: product.price,
          subtotal: lineSubtotal,
        });
      }

      let discount = 0;
      if (promoCode) {
        const promo = await tx.promo.findUnique({
          where: { code: promoCode.trim().toUpperCase() },
        });
        if (promo && promo.isActive && subtotal >= promo.minOrder) {
          discount =
            promo.type === "PERCENT"
              ? Math.floor((subtotal * promo.value) / 100)
              : Math.min(promo.value, subtotal);
        }
      }

      const taxableAmount = Math.max(0, subtotal - discount);
      const tax = Math.round(taxableAmount * 0.1);
      const total = taxableAmount + tax;

      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const invoiceNumber = `INV-${dateStr}-${randomSuffix}`;

      const order = await tx.order.create({
        data: {
          invoiceNumber,
          subtotal,
          discount,
          tax,
          total,
          paymentMethod,
          status: "PAID",
          items: {
            create: orderItemsData.map((oi) => ({
              productId: oi.productId,
              quantity: oi.quantity,
              unitPrice: oi.unitPrice,
              subtotal: oi.subtotal,
            })),
          },
        },
        include: {
          items: {
            include: { product: true },
          },
        },
      });

      for (const oi of orderItemsData) {
        await tx.product.update({
          where: { id: oi.productId },
          data: {
            stock: { decrement: oi.quantity },
          },
        });
      }

      return order;
    });

    revalidatePath("/");
    return { success: true, order: result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Terjadi kesalahan saat memproses transaksi.";
    return { success: false, message };
  }
}