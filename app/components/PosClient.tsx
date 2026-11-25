"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Tag,
  CreditCard,
  Banknote,
  Printer,
  CheckCircle2,
  Package,
  X,
} from "lucide-react";
import { validatePromoCode, processCheckout } from "@/app/actions/pos";

interface Category {
  id: number;
  name: string;
}

interface Product {
  id: number;
  name: string;
  categoryId: number;
  category: Category;
  price: number;
  stock: number;
  imageUrl: string | null;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface ReceiptOrder {
  id: number;
  invoiceNumber: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: string;
  createdAt: Date;
  items: {
    id: number;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    product: {
      name: string;
    };
  }[];
}

interface PosClientProps {
  initialCategories: Category[];
  initialProducts: Product[];
}

export default function PosClient({
  initialCategories,
  initialProducts,
}: PosClientProps) {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);

  // State Promo
  const [promoInput, setPromoInput] = useState("");
  const [appliedPromo, setAppliedPromo] = useState<{
    code: string;
    type: string;
    value: number;
  } | null>(null);
  const [promoMessage, setPromoMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [isValidatingPromo, setIsValidatingPromo] = useState(false);

  // State Checkout & Struk
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "QRIS">("CASH");
  const [isProcessing, setIsProcessing] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState<ReceiptOrder | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sinkronisasi ulang jika initialProducts diperbarui dari server
  useEffect(() => {
    setProducts(initialProducts);
  }, [initialProducts]);

  // Keyboard Shortcuts: '/' untuk fokus search, 'Esc' untuk tutup modal struk
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInputFocused =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable;

      if (e.key === "/" && !isInputFocused) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && receiptOrder) {
        setReceiptOrder(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [receiptOrder]);

  // Filter produk secara instan di sisi client
  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const matchesCategory =
        selectedCategoryId === null || product.categoryId === selectedCategoryId;
      const matchesSearch = product.name
        .toLowerCase()
        .includes(searchQuery.toLowerCase().trim());
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategoryId, searchQuery]);

  // Kalkulasi angka keranjang secara real-time
  const subtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  }, [cart]);

  const discount = useMemo(() => {
    if (!appliedPromo) return 0;
    return appliedPromo.type === "PERCENT"
      ? Math.floor((subtotal * appliedPromo.value) / 100)
      : Math.min(appliedPromo.value, subtotal);
  }, [appliedPromo, subtotal]);

  const taxableAmount = Math.max(0, subtotal - discount);
  const tax = Math.round(taxableAmount * 0.1);
  const total = taxableAmount + tax;

  const formatRupiah = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  // Fungsi manipulasi keranjang
  const handleAddToCart = (product: Product) => {
    if (product.stock <= 0) return;

    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const handleUpdateQuantity = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.product.id !== productId) return item;
          const nextQty = item.quantity + delta;
          if (nextQty <= 0) return null;
          if (nextQty > item.product.stock) return item;
          return { ...item, quantity: nextQty };
        })
        .filter((item): item is CartItem => item !== null)
    );
  };

  const handleRemoveItem = (productId: number) => {
    setCart((prev) => prev.filter((item) => item.product.id !== productId));
  };

  // Validasi kode promo ke server
  const handleApplyPromo = async () => {
    if (cart.length === 0) {
      setPromoMessage({ type: "error", text: "Tambahkan produk ke keranjang dulu." });
      return;
    }

    setIsValidatingPromo(true);
    setPromoMessage(null);

    const res = await validatePromoCode(promoInput, subtotal);
    setIsValidatingPromo(false);

    if (res.valid && res.promo) {
      setAppliedPromo({
        code: res.promo.code,
        type: res.promo.type,
        value: res.promo.value,
      });
      setPromoMessage({ type: "success", text: res.message });
    } else {
      setAppliedPromo(null);
      setPromoMessage({ type: "error", text: res.message });
    }
  };

  // Proses pembayaran ke server
  const handleCheckout = async () => {
    if (cart.length === 0 || isProcessing) return;

    setIsProcessing(true);
    const res = await processCheckout({
      items: cart.map((item) => ({
        productId: item.product.id,
        quantity: item.quantity,
      })),
      promoCode: appliedPromo?.code,
      paymentMethod,
    });
    setIsProcessing(false);

    if (res.success && res.order) {
      // Kurangi stok lokal langsung agar UI responsif
      setProducts((prev) =>
        prev.map((prod) => {
          const bought = cart.find((c) => c.product.id === prod.id);
          return bought
            ? { ...prod, stock: Math.max(0, prod.stock - bought.quantity) }
            : prod;
        })
      );

      setReceiptOrder(res.order as unknown as ReceiptOrder);
      setCart([]);
      setAppliedPromo(null);
      setPromoInput("");
      setPromoMessage(null);
    } else {
      alert(res.message || "Gagal memproses pembayaran.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Header Utama (Disembunyikan saat print) */}
      <header className="no-print border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-emerald-400">
              DigiDreams Space
            </h1>
            <p className="text-xs text-slate-400">Mini-POS & Order Engine</p>
          </div>
          <div className="hidden text-xs text-slate-400 sm:block">
            Tekan <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">/</kbd> untuk cari menu
          </div>
        </div>
      </header>

      {/* Layout Utama 2 Kolom (Disembunyikan saat print) */}
      <main className="no-print mx-auto grid max-w-7xl grid-cols-1 gap-6 p-6 lg:grid-cols-12">
        {/* KOLOM KIRI: Katalog Produk (8 Kolom) */}
        <section className="space-y-5 lg:col-span-8">
          {/* Search Bar & Filter Kategori */}
          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari menu kopi, makanan, atau paket workspace... (Tekan '/')"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedCategoryId(null)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  selectedCategoryId === null
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Semua Menu
              </button>
              {initialCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                    selectedCategoryId === cat.id
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          {/* Grid Produk */}
          {filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900 py-16 text-slate-400">
              <Package className="mb-2 h-10 w-10 text-slate-600" />
              <p className="text-sm">Menu tidak ditemukan.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
              {filteredProducts.map((product) => {
                const inCartQty =
                  cart.find((c) => c.product.id === product.id)?.quantity ?? 0;
                const isOutOfStock = product.stock === 0;
                const isMaxedInCart = inCartQty >= product.stock;

                return (
                  <div
                    key={product.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900 p-4 transition hover:border-slate-700"
                  >
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-slate-300">
                          {product.category.name}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                            isOutOfStock
                              ? "bg-rose-500/20 text-rose-400"
                              : product.stock <= 5
                              ? "bg-amber-500/20 text-amber-400"
                              : "bg-emerald-500/20 text-emerald-400"
                          }`}
                        >
                          {isOutOfStock ? "Habis" : `Stok: ${product.stock}`}
                        </span>
                      </div>
                      <h3 className="font-semibold text-slate-100">{product.name}</h3>
                      <p className="mt-1 text-base font-bold text-emerald-400">
                        {formatRupiah(product.price)}
                      </p>
                    </div>

                    <button
                      onClick={() => handleAddToCart(product)}
                      disabled={isOutOfStock || isMaxedInCart}
                      className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                    >
                      <Plus className="h-4 w-4" />
                      {isOutOfStock
                        ? "Stok Habis"
                        : isMaxedInCart
                        ? "Batas Stok"
                        : "Tambah"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* KOLOM KANAN: Keranjang Kasir (4 Kolom) */}
        <aside className="lg:col-span-4">
          <div className="sticky top-6 flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-5">
            <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5 text-emerald-400" />
                <h2 className="font-bold text-slate-100">Keranjang Pesanan</h2>
              </div>
              <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                {cart.reduce((acc, item) => acc + item.quantity, 0)} item
              </span>
            </div>

            {/* Daftar Item Keranjang */}
            <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
              {cart.length === 0 ? (
                <p className="py-10 text-center text-xs text-slate-500">
                  Belum ada menu yang dipilih.
                </p>
              ) : (
                cart.map((item) => (
                  <div
                    key={item.product.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-200">
                        {item.product.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatRupiah(item.product.price)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleUpdateQuantity(item.product.id, -1)}
                        className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-xs font-semibold">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => handleUpdateQuantity(item.product.id, 1)}
                        disabled={item.quantity >= item.product.stock}
                        className="rounded bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveItem(item.product.id)}
                        className="ml-1 rounded p-1 text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input Kode Promo */}
            <div className="mt-4 border-t border-slate-800 pt-4">
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <Tag className="h-3.5 w-3.5 text-emerald-400" />
                Kode Promo
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                  placeholder="Contoh: DIGIZEN10"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs uppercase text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"
                />
                <button
                  onClick={handleApplyPromo}
                  disabled={isValidatingPromo || !promoInput.trim()}
                  className="rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
                >
                  {isValidatingPromo ? "..." : "Apply"}
                </button>
              </div>
              {promoMessage && (
                <p
                  className={`mt-1.5 text-xs ${
                    promoMessage.type === "success"
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {promoMessage.text}
                </p>
              )}
            </div>

            {/* Ringkasan Kalkulasi */}
            <div className="mt-4 space-y-2 border-t border-slate-800 pt-4 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span>
                <span>{formatRupiah(subtotal)}</span>
              </div>
              <div className="flex justify-between text-emerald-400">
                <span>Diskon {appliedPromo ? `(${appliedPromo.code})` : ""}</span>
                <span>- {formatRupiah(discount)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>PPN (10%)</span>
                <span>{formatRupiah(tax)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-800 pt-2 text-base font-bold text-slate-100">
                <span>Total Akhir</span>
                <span className="text-emerald-400">{formatRupiah(total)}</span>
              </div>
            </div>

            {/* Metode Pembayaran */}
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-slate-300">Metode Pembayaran</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod("CASH")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition ${
                    paymentMethod === "CASH"
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                      : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  <Banknote className="h-4 w-4" />
                  CASH
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("QRIS")}
                  className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-semibold transition ${
                    paymentMethod === "QRIS"
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                      : "border-slate-700 bg-slate-950 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  <CreditCard className="h-4 w-4" />
                  QRIS
                </button>
              </div>
            </div>

            {/* Tombol Bayar Sekarang */}
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0 || isProcessing}
              className="mt-5 w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            >
              {isProcessing ? "Memproses..." : `Bayar Sekarang • ${formatRupiah(total)}`}
            </button>
          </div>
        </aside>
      </main>

      {/* MODAL STRUK DIGITAL (RECEIPT) */}
      {receiptOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="receipt-print-area w-full max-w-sm rounded-2xl bg-white p-6 text-slate-900 shadow-2xl">
            <div className="no-print mb-2 flex justify-end">
              <button
                onClick={() => setReceiptOrder(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-b border-dashed border-slate-300 pb-4 text-center">
              <div className="no-print mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-extrabold tracking-tight">DigiDreams Space</h2>
              <p className="text-xs text-slate-500">Coworking & Specialty Coffee</p>
              <p className="mt-2 font-mono text-xs font-semibold text-slate-700">
                {receiptOrder.invoiceNumber}
              </p>
              <p className="text-[11px] text-slate-500">
                {new Date(receiptOrder.createdAt).toLocaleString("id-ID")} •{" "}
                {receiptOrder.paymentMethod}
              </p>
            </div>

            {/* Daftar Item Struk */}
            <div className="my-4 space-y-2 border-b border-dashed border-slate-300 pb-4 text-xs">
              {receiptOrder.items.map((item) => (
                <div key={item.id} className="flex justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-800">{item.product.name}</p>
                    <p className="text-[11px] text-slate-500">
                      {item.quantity} x {formatRupiah(item.unitPrice)}
                    </p>
                  </div>
                  <span className="font-semibold text-slate-800">
                    {formatRupiah(item.subtotal)}
                  </span>
                </div>
              ))}
            </div>

            {/* Rincian Biaya Struk */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>{formatRupiah(receiptOrder.subtotal)}</span>
              </div>
              {receiptOrder.discount > 0 && (
                <div className="flex justify-between text-emerald-600">
                  <span>Diskon</span>
                  <span>- {formatRupiah(receiptOrder.discount)}</span>
                </div>
              )}
              <div className="flex justify-between text-slate-600">
                <span>PPN (10%)</span>
                <span>{formatRupiah(receiptOrder.tax)}</span>
              </div>
              <div className="flex justify-between border-t border-slate-300 pt-2 text-sm font-bold text-slate-900">
                <span>TOTAL</span>
                <span>{formatRupiah(receiptOrder.total)}</span>
              </div>
            </div>

            <p className="mt-4 text-center text-[11px] text-slate-500">
              Terima kasih telah berkunjung ke DigiDreams Space!
            </p>

            {/* Tombol Aksi Modal (Disembunyikan saat print) */}
            <div className="no-print mt-5 grid grid-cols-2 gap-2">
              <button
                onClick={() => window.print()}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Printer className="h-4 w-4" />
                Cetak Struk
              </button>
              <button
                onClick={() => setReceiptOrder(null)}
                className="rounded-lg bg-slate-900 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Transaksi Baru
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}