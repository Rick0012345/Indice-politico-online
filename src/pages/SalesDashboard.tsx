import React, {useMemo, useState} from 'react';
import {
  ArrowUpRight,
  DollarSign,
  Package,
  Search,
  ShoppingCart,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react';

type ChannelPerformance = {
  channel: string;
  revenue: string;
  orders: number;
  growth: string;
  width: string;
};

type ProductPerformance = {
  name: string;
  category: string;
  units: number;
  revenue: string;
};

type ProductOption = {
  id: string;
  name: string;
  category: string;
  unitPrice: number;
};

const channelPerformance: ChannelPerformance[] = [
  {channel: 'Site', revenue: 'R$ 82.400', orders: 412, growth: '+18%', width: '88%'},
  {channel: 'Marketplace', revenue: 'R$ 56.100', orders: 301, growth: '+11%', width: '72%'},
  {channel: 'Instagram', revenue: 'R$ 31.900', orders: 174, growth: '+24%', width: '56%'},
  {channel: 'WhatsApp', revenue: 'R$ 24.700', orders: 129, growth: '+9%', width: '44%'},
];

const topProducts: ProductPerformance[] = [
  {name: 'Kit Premium', category: 'Assinaturas', units: 245, revenue: 'R$ 48.300'},
  {name: 'Plano Pro', category: 'Servicos', units: 188, revenue: 'R$ 37.900'},
  {name: 'Combo Start', category: 'Pacotes', units: 163, revenue: 'R$ 29.600'},
  {name: 'Consultoria Plus', category: 'B2B', units: 94, revenue: 'R$ 24.800'},
];

const productOptions: ProductOption[] = [
  {id: 'kit-premium', name: 'Kit Premium', category: 'Assinaturas', unitPrice: 197},
  {id: 'plano-pro', name: 'Plano Pro', category: 'Servicos', unitPrice: 249},
  {id: 'combo-start', name: 'Combo Start', category: 'Pacotes', unitPrice: 159},
  {id: 'consultoria-plus', name: 'Consultoria Plus', category: 'B2B', unitPrice: 690},
  {id: 'plano-essencial', name: 'Plano Essencial', category: 'Servicos', unitPrice: 119},
  {id: 'upgrade-enterprise', name: 'Upgrade Enterprise', category: 'B2B', unitPrice: 1200},
];

export const SalesDashboard = () => {
  const [productSearch, setProductSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState(productOptions[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);

  const filteredProducts = useMemo(() => {
    const query = productSearch.trim().toLocaleLowerCase('pt-BR');
    if (!query) return productOptions;

    return productOptions.filter((product) => {
      const target = `${product.name} ${product.category}`.toLocaleLowerCase('pt-BR');
      return target.includes(query);
    });
  }, [productSearch]);

  const selectedProduct =
    productOptions.find((product) => product.id === selectedProductId) ?? filteredProducts[0] ?? null;

  const estimatedTotal = selectedProduct ? selectedProduct.unitPrice * quantity : 0;

  const handlePickProduct = (product: ProductOption) => {
    setSelectedProductId(product.id);
    setProductSearch(product.name);
    setIsProductDropdownOpen(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">
              Dashboard de vendas
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">
              Visao comercial exclusiva
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Acompanhe receita, conversao e desempenho por canal em tempo real.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <TrendingUp size={16} />
            Exportar relatorio
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <label
              htmlFor="quick-product-search"
              className="text-xs font-bold uppercase tracking-wide text-slate-500"
            >
              Registro rapido: buscar produto
            </label>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                id="quick-product-search"
                type="text"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Pesquisar produto para registrar venda"
                className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>
          <p className="text-xs font-semibold text-slate-500">
            {filteredProducts.length} resultado(s) encontrado(s)
          </p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Faturamento
            </span>
            <DollarSign className="text-emerald-600" size={18} />
          </div>
          <p className="mt-4 text-2xl font-black text-slate-900">R$ 195.100</p>
          <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-600">
            <ArrowUpRight size={14} />
            +16% vs mes anterior
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Pedidos
            </span>
            <ShoppingCart className="text-blue-600" size={18} />
          </div>
          <p className="mt-4 text-2xl font-black text-slate-900">1.016</p>
          <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-blue-600">
            <ArrowUpRight size={14} />
            +8% no ciclo atual
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Ticket medio
            </span>
            <Package className="text-violet-600" size={18} />
          </div>
          <p className="mt-4 text-2xl font-black text-slate-900">R$ 192,03</p>
          <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-violet-600">
            <ArrowUpRight size={14} />
            +6,2% de incremento
          </p>
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
              Conversao
            </span>
            <Users className="text-amber-600" size={18} />
          </div>
          <p className="mt-4 text-2xl font-black text-slate-900">4,8%</p>
          <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-amber-600">
            <ArrowUpRight size={14} />
            +0,9 p.p. no funil
          </p>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <h2 className="text-lg font-black text-slate-900">Performance por canal</h2>
          <p className="mt-1 text-sm text-slate-500">Receita e pedidos no periodo selecionado</p>

          <div className="mt-6 space-y-5">
            {channelPerformance.map((channel) => (
              <div key={channel.channel} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-700">{channel.channel}</p>
                  <p className="text-xs font-semibold text-slate-500">
                    {channel.revenue} | {channel.orders} pedidos | {channel.growth}
                  </p>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400"
                    style={{width: channel.width}}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Target className="text-emerald-600" size={18} />
            <h2 className="text-lg font-black text-slate-900">Meta mensal</h2>
          </div>
          <p className="mt-1 text-sm text-slate-500">Objetivo: R$ 220.000</p>

          <div className="mt-6">
            <div className="flex items-end justify-between">
              <p className="text-3xl font-black text-slate-900">88,6%</p>
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-600">
                R$ 195.100 atingidos
              </p>
            </div>
            <div className="mt-3 h-3 rounded-full bg-slate-100">
              <div className="h-3 w-[88.6%] rounded-full bg-emerald-500" />
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-500">
              Faltam R$ 24.900 para fechar a meta deste mes.
            </p>
          </div>
        </article>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h2 className="text-lg font-black text-slate-900">Registrar venda</h2>
          <p className="mt-1 text-sm text-slate-500">
            Preencha os dados da venda e use a pesquisa para localizar o produto rapidamente.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="product-search" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Buscar produto
            </label>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                id="product-search"
                type="text"
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="Digite nome ou categoria do produto"
                className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="product-search-register"
              className="text-xs font-bold uppercase tracking-wide text-slate-500"
            >
              Produto (com pesquisa)
            </label>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                id="product-search-register"
                type="text"
                value={productSearch}
                onFocus={() => setIsProductDropdownOpen(true)}
                onBlur={() => setTimeout(() => setIsProductDropdownOpen(false), 120)}
                onChange={(event) => {
                  setProductSearch(event.target.value);
                  setIsProductDropdownOpen(true);
                }}
                placeholder="Pesquise e selecione um produto"
                className="w-full rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              {isProductDropdownOpen && (
                <div className="absolute z-20 mt-2 max-h-56 w-full overflow-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg">
                  {filteredProducts.length > 0 ? (
                    filteredProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handlePickProduct(product)}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                      >
                        <span className="font-semibold text-slate-800">{product.name}</span>
                        <span className="text-xs text-slate-500">{product.category}</span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-sm text-slate-500">Nenhum produto encontrado.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="customer-name" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Cliente
            </label>
            <input
              id="customer-name"
              type="text"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Nome do cliente"
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="quantity" className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Quantidade
            </label>
            <input
              id="quantity"
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                setQuantity(Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
              }}
              className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Total estimado</p>
            <p className="text-xl font-black text-slate-900">
              {estimatedTotal.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <ShoppingCart size={16} />
            Confirmar registro
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">Top produtos</h2>
        <p className="mt-1 text-sm text-slate-500">Itens com maior impacto em receita</p>

        <div className="mt-5 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead>
              <tr className="text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                <th className="px-2 py-3">Produto</th>
                <th className="px-2 py-3">Categoria</th>
                <th className="px-2 py-3 text-right">Unidades</th>
                <th className="px-2 py-3 text-right">Receita</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {topProducts.map((product) => (
                <tr key={product.name}>
                  <td className="px-2 py-3 font-semibold text-slate-800">{product.name}</td>
                  <td className="px-2 py-3 text-slate-600">{product.category}</td>
                  <td className="px-2 py-3 text-right text-slate-700">{product.units}</td>
                  <td className="px-2 py-3 text-right font-bold text-slate-900">{product.revenue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
