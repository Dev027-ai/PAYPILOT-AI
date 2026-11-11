import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  Activity, ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, BarChart3, Check,
  CreditCard, Database, ExternalLink, Globe2, LayoutDashboard,
  LoaderCircle, LockKeyhole, MessageCircle, Package, RefreshCw, Search, Settings2, ShieldCheck,
  ShoppingBag, SlidersHorizontal, Sparkles, Wallet, X,
} from 'lucide-react';
import {
  useAskAssistant, useCaptureCheckoutOrder, useCheckPayPalSandbox, useCreateCheckoutOrder, useGetFxEstimate,
  useGetIntegrationStatus, useGetOverview, useGetProducts, useGetSpendingAnalytics,
  useGetTransaction, useGetTransactions,
  getGetOverviewQueryKey, getGetTransactionsQueryKey, getGetSpendingAnalyticsQueryKey,
  getGetTransactionQueryKey, getGetFxEstimateQueryKey,
} from '@workspace/api-client-react';
import type { AssistantResponse, CheckoutCapture, Product, Transaction } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient();
const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/assistant', label: 'AI assistant', icon: MessageCircle },
  { href: '/checkout', label: 'Demo checkout', icon: ShoppingBag },
  { href: '/transactions', label: 'Transactions', icon: CreditCard },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/international', label: 'International', icon: Globe2 },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

function money(minor: number, currency = 'USD') {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(minor / 100);
}
function amount(value: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
function dateLabel(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}
function statusClass(status: string) {
  return `status-tag${status === 'pending' ? ' pending' : status === 'failed' ? ' failed' : ''}`;
}
function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="loading-block" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 24 : 42, width: `${92 - i * 7}%` }} />)}
  </div>;
}
function ErrorState({ retry, message = 'We could not load this workspace view.' }: { retry: () => void; message?: string }) {
  return <div className="error-box" role="alert"><strong>That did not load</strong>{message}<div style={{ marginTop: 14 }}><button className="button small" onClick={retry} data-testid="button-retry"><RefreshCw size={13} />Try again</button></div></div>;
}
function EmptyState({ title, copy }: { title: string; copy: string }) {
  return <div className="empty-state"><strong>{title}</strong>{copy}</div>;
}
function PageHeading({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p className="subtitle">{subtitle}</p></div>{children}</div>;
}
function Panel({ title, caption, children, action }: { title: string; caption?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="panel"><header className="panel-head"><div><h2 className="panel-title">{title}</h2>{caption && <div className="panel-caption">{caption}</div>}</div>{action}</header>{children}</section>;
}
function SourceTag({ children }: { children: ReactNode }) { return <span className="source-pill"><span className="dot" style={{ width: 5, height: 5 }} />{children}</span>; }
function TransactionRow({ tx, onClick }: { tx: Transaction; onClick?: () => void }) {
  return <div className="transaction-row" role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={onClick ? e => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined} data-testid={`row-transaction-${tx.id}`}>
    <div className="merchant-line"><div className="merchant-icon"><CreditCard size={15} /></div><div style={{ minWidth: 0 }}><div className="merchant-name">{tx.merchant}</div><div className="merchant-meta">{tx.category} · {dateLabel(tx.date)}</div></div></div>
    <div><div className="transaction-amount">{money(tx.amountMinor, tx.currency)}</div><div style={{ textAlign: 'right' }}><span className={statusClass(tx.status)}>{tx.status}</span></div></div>
  </div>;
}
function Chart({ data }: { data: { label: string; receivedMinor: number; spentMinor: number }[] }) {
  const max = Math.max(1, ...data.flatMap(d => [d.receivedMinor, d.spentMinor]));
  if (!data.length) return <EmptyState title="No activity to chart" copy="Activity will appear here when the source provides it." />;
  return <><div className="activity-chart" role="img" aria-label="Received and spent activity chart">{data.map((point, index) => <div className="bar-group" key={`${point.label}-${index}`}><div className="bars"><div className="bar in" title={`Received ${money(point.receivedMinor)}`} style={{ height: `${Math.max(3, point.receivedMinor / max * 100)}%` }} /><div className="bar out" title={`Spent ${money(point.spentMinor)}`} style={{ height: `${Math.max(3, point.spentMinor / max * 100)}%` }} /></div><span className="bar-label">{point.label}</span></div>)}</div><div className="chart-legend"><span className="legend-key"><i />Received</span><span className="legend-key"><i className="out-key" />Spent</span></div></>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const current = navigation.find(item => item.href === location)?.label ?? 'Workspace';
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand"><div className="brand-mark"><Wallet size={18} /></div><div className="brand-name">PayPilot <span>AI</span></div></div>
      <div className="nav-label">Workspace</div>
      <nav className="nav-list">{navigation.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={`nav-link${location === href ? ' active' : ''}`} data-testid={`link-nav-${href.slice(1) || 'overview'}`} aria-current={location === href ? 'page' : undefined}><Icon size={16} strokeWidth={1.8} /><span>{label}</span></Link>)}</nav>
      <div className="side-foot"><div className="sandbox-card"><div className="sandbox-row"><span className="dot" />Sandbox workspace</div><div className="sandbox-caption">Independent payment intelligence. Not an official PayPal product.</div></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="mobile-brand"><span className="brand-mark"><Wallet size={15} /></span>PayPilot <span style={{ color: '#628cb4' }}>AI</span></div><div className="crumb">Workspace <span style={{ padding: '0 7px', color: '#b0bac5' }}>/</span>{current}</div><div className="top-right"><span className="status-pill"><span className="dot" />PAYPAL SANDBOX</span><div className="avatar" aria-label="Demo workspace">PW</div></div></header>
      {children}
    </main>
  </div>;
}

function OverviewPage() {
  const q = useGetOverview();
  const overview = q.data;
  return <div className="content">
    <PageHeading eyebrow="Payment intelligence · Sandbox" title="Your money, in focus." subtitle="A clear view of payment activity from this synthetic demo workspace." >
      <Link href="/transactions" className="button" data-testid="link-view-activity">View all activity <ArrowRight size={14} /></Link>
    </PageHeading>
    {q.isLoading ? <Loading rows={5} /> : q.isError || !overview ? <Panel title="Overview"><ErrorState retry={() => q.refetch()} /></Panel> : <>
      <div className="metric-grid">
        <div className="metric"><div className="metric-label">Received this month <ArrowDownLeft size={14} color="#589078" /></div><div className="metric-value" data-testid="value-received">{money(overview.receivedThisMonthMinor)}</div><div className="metric-note">Based on {overview.sourceLabel}</div></div>
        <div className="metric"><div className="metric-label">Spent this month <ArrowUpRight size={14} color="#547ca2" /></div><div className="metric-value" data-testid="value-spent">{money(overview.spentThisMonthMinor)}</div><div className="metric-note">Completed and pending activity</div></div>
        <div className="metric"><div className="metric-label">Monthly change <Activity size={14} color="#547ca2" /></div><div className="metric-value">{overview.monthlyChangePercent > 0 ? '+' : ''}{(Number(overview.monthlyChangePercent) || 0).toFixed(1)}%</div><div className="metric-note">Compared with prior month</div></div>
      </div>
      <div className="workspace-grid">
        <div style={{ display: 'grid', gap: 20 }}>
          <Panel title="Cash flow" caption="Received and spent across the latest activity periods"><div className="panel-body"><Chart data={overview.activity ?? []} /></div></Panel>
          <Panel title="Recent activity" caption="Latest transactions in your workspace" action={<Link href="/transactions" className="button small" data-testid="link-all-transactions">All activity <ArrowRight size={12} /></Link>}>
            {(overview.transactions ?? []).length ? <div className="list">{(overview.transactions ?? []).slice(0, 6).map(tx => <Link href={`/transactions?selected=${encodeURIComponent(tx.id)}`} key={tx.id} data-testid={`link-recent-${tx.id}`}><TransactionRow tx={tx} /></Link>)}</div> : <EmptyState title="A clean slate" copy="No transactions are available in this workspace yet." />}
          </Panel>
        </div>
        <div style={{ display: 'grid', gap: 17 }}>
          <Panel title="Workspace context"><div className="panel-body"><div className="callout"><strong>Synthetic demo data</strong><br />This view uses {overview.sourceLabel}. It is not live account activity and PayPilot AI is an independent demo workspace.</div><div style={{ marginTop: 16 }}><SourceTag>{overview.mode}</SourceTag></div></div></Panel>
          <Panel title="A useful next step"><div className="panel-body"><p className="subtitle" style={{ marginBottom: 15 }}>Ask a question about the activity shown here, or compare spending over time.</p><div style={{ display: 'grid', gap: 8 }}><Link href="/assistant" className="button" data-testid="link-ask-assistant"><Sparkles size={14} />Ask the assistant</Link><Link href="/analytics" className="button" data-testid="link-explore-analytics"><BarChart3 size={14} />Explore analytics</Link></div></div></Panel>
          <div className="footer-note">Payment data is presented for demonstration and educational purposes.</div>
        </div>
      </div>
    </>}
  </div>;
}

type ChatItem = { role: 'user' | 'assistant'; text: string; answer?: AssistantResponse };
function AssistantPage() {
  const ask = useAskAssistant();
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<ChatItem[]>([{ role: 'assistant', text: 'I can help make sense of the activity available in this PayPilot workspace. I’ll be clear about whether an answer comes from configured AI or the demo assistant.' }]);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, ask.isPending]);
  function submit(value = text) {
    const clean = value.trim();
    if (!clean || ask.isPending) return;
    setMessages(items => [...items, { role: 'user', text: clean }]);
    setText('');
    ask.mutate({ data: { message: clean, history: messages.slice(-10).map(item => ({ role: item.role, content: item.text.slice(0, 2000) })) } }, { onSuccess: answer => setMessages(items => [...items, { role: 'assistant', text: answer.reply, answer }]) });
  }
  return <div className="content">
    <PageHeading eyebrow="Conversational intelligence" title="Ask about your payments." subtitle="Answers are grounded in available workspace data, not an assumed live PayPal account." />
    <div className="assistant-layout">
      <Panel title="Payment assistant" caption="Private to this demo workspace">
        <div className="chat-panel">
          <div className="chat-messages">{messages.map((item, i) => <div key={i} className={`message ${item.role}`} data-testid={`message-${item.role}-${i}`}>{item.text}{item.answer && <div className="message-source">Source mode: {item.answer.mode === 'demo-fallback' ? 'demo assistant fallback' : 'configured AI'}{(item.answer.sources ?? []).length ? ` · ${(item.answer.sources ?? []).join(' · ')}` : ''}</div>}{(item.answer?.products ?? []).length ? <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{(item.answer.products ?? []).slice(0, 3).map(product => <div className="callout" key={product.id} data-testid={`assistant-product-${product.id}`}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}><strong>{product.name}</strong><strong className="mono">{money(product.priceMinor, product.currency)}</strong></div><p className="subtitle" style={{ fontSize: 11, margin: '6px 0 10px' }}>{product.description}</p><Link href={`/checkout?product=${encodeURIComponent(product.id)}`} className="button small primary" data-testid={`link-assistant-product-${product.id}`}>Review in checkout <ArrowRight size={12} /></Link></div>)}</div> : null}</div>)}{ask.isPending && <div className="message assistant"><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><LoaderCircle size={14} />Checking workspace context…</span></div>}{ask.isError && <div className="inline-alert" role="alert">The assistant could not respond. Check the connection and try again.</div>}<div ref={bottom} /></div>
          <form className="chat-compose" onSubmit={e => { e.preventDefault(); submit(); }}><textarea className="field" value={text} onChange={e => setText(e.target.value)} placeholder="For example: what were my largest purchases?" aria-label="Ask the assistant" data-testid="input-assistant-question" maxLength={2000} /><button className="button primary" type="submit" disabled={!text.trim() || ask.isPending} data-testid="button-send-question"><ArrowRight size={15} /><span className="sr-only">Send</span></button></form>
        </div>
      </Panel>
      <aside style={{ display: 'grid', gap: 16 }}>
        <Panel title="Try a question"><div className="panel-body">{['Summarize my recent activity', 'What categories are driving spending?', 'Show me pending transactions'].map((prompt, i) => <button key={prompt} onClick={() => submit(prompt)} className="suggestion" data-testid={`button-suggestion-${i}`}>{prompt}<ArrowRight size={12} style={{ float: 'right' }} /></button>)}</div></Panel>
        <div className="callout"><strong>Grounded, not guessed.</strong><br />Assistant answers use the response mode and source labels returned by the server. Demo fallback is identified as such; it is not represented as configured AI.</div>
      </aside>
    </div>
  </div>;
}

function CheckoutPage() {
  const productsQ = useGetProducts();
  const statusQ = useGetIntegrationStatus();
  const create = useCreateCheckoutOrder();
  const capture = useCaptureCheckoutOrder();
  const client = useQueryClient();
  const [selected, setSelected] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [order, setOrder] = useState<{ id: string; amountMinor: number; currency: string; productName: string; approveUrl: string | null; paypalOrderId: string | null } | null>(null);
  const [result, setResult] = useState<CheckoutCapture | null>(null);
  const [captureError, setCaptureError] = useState('');
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const captureStarted = useRef(false);
  const products = productsQ.data ?? [];
  const ready = statusQ.data?.paypalConfigured === true;

  useEffect(() => {
    const productId = new URLSearchParams(window.location.search).get('product');
    if (!productId || !productsQ.data) return;
    const product = productsQ.data.find(item => item.id === productId);
    if (product) setSelected(product);
  }, [productsQ.data]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const paypalId = query.get('token') || query.get('paypalOrderId');
    const orderId = query.get('paypilotOrderId') || sessionStorage.getItem('paypilot_order_id');
    if (query.get('cancelled') === '1') {
      setCaptureError('PayPal approval was cancelled. No payment was captured.');
      if (orderId) {
        setCaptureError('Checking the saved order state after the PayPal return…');
        fetch(`/api/checkout/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' })
          .then(async response => {
            if (response.status === 409) {
              const statusResponse = await fetch(`/api/checkout/orders/${encodeURIComponent(orderId)}`);
              if (!statusResponse.ok) throw new Error('The order already has a conflicting saved state; status refresh failed.');
              const saved = await statusResponse.json();
              if (saved.verified === true && saved.status === 'completed') {
                setResult({ orderId: saved.orderId, paypalOrderId: saved.paypalOrderId || '', status: 'completed', amountMinor: saved.amountMinor, currency: saved.currency, verified: true, transaction: null });
                setCaptureError('A verified PayPal capture already exists. The cancellation was not recorded.');
                client.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
                client.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
                client.invalidateQueries({ queryKey: getGetSpendingAnalyticsQueryKey() });
                return;
              }
              throw new Error('The order already has a saved state that prevented cancellation. Refresh its status before retrying.');
            }
            if (!response.ok) throw new Error('Could not persist checkout cancellation');
            setCaptureError('PayPal approval was cancelled. No payment was captured.');
          })
          .catch(() => setCaptureError('PayPal approval was cancelled, but the local order state could not be confirmed. Refresh order status before retrying.'));
      }
      sessionStorage.removeItem('paypilot_order_id');
      return;
    }
    if (!paypalId || !orderId || captureStarted.current) return;
    captureStarted.current = true;
    capture.mutate({ orderId, data: { paypalOrderId: paypalId } }, {
      onSuccess: response => {
        setResult(response);
        if (response.verified && response.status === 'completed') {
          client.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
          client.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
          client.invalidateQueries({ queryKey: getGetSpendingAnalyticsQueryKey() });
          sessionStorage.removeItem('paypilot_order_id');
        }
      },
      onError: () => setCaptureError('The server could not verify this approval. No payment success is being claimed. Check the order status or try again.')
    });
  }, []); // Return confirmation is captured exactly once; the mutation response is authoritative.

  async function refreshOrderStatus(orderId: string, paypalOrderId: string | null) {
    setStatusRefreshing(true);
    setCaptureError('');
    try {
      const response = await fetch(`/api/checkout/orders/${encodeURIComponent(orderId)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
      const mappedStatus = payload.status === 'cancelled' ? 'failed' : payload.status;
      setResult({
        orderId: payload.orderId,
        paypalOrderId: payload.paypalOrderId || paypalOrderId || '',
        status: mappedStatus,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        verified: payload.verified === true && mappedStatus === 'completed',
        transaction: null,
      });
      if (payload.verified === true && mappedStatus === 'completed') {
        client.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
        client.invalidateQueries({ queryKey: getGetTransactionsQueryKey() });
        client.invalidateQueries({ queryKey: getGetSpendingAnalyticsQueryKey() });
      }
      if (payload.status === 'cancelled') setCaptureError('This checkout was cancelled locally. No payment success is claimed.');
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'Order status could not be refreshed.');
    } finally {
      setStatusRefreshing(false);
    }
  }

  function prepareOrder() {
    if (!selected || !ready) return;
    setResult(null); setCaptureError('');
    create.mutate({ data: { productId: selected.id, quantity } }, { onSuccess: created => {
      setOrder({ id: created.id, amountMinor: created.amountMinor, currency: created.currency, productName: created.productName, approveUrl: created.approveUrl, paypalOrderId: created.paypalOrderId });
      if (created.paypalOrderId) sessionStorage.setItem('paypilot_order_id', created.id);
    } });
  }
  return <div className="content">
    <PageHeading eyebrow="Buyer-approved demo purchase" title="A small catalog. A clear checkout." subtitle="Choose a product, review the exact amount, then approve through PayPal Sandbox." />
    <div className="workspace-grid">
      <div>
        <div className="callout" style={{ marginBottom: 15 }}><strong>Sandbox only · synthetic catalog</strong><br />This is an independent PayPilot AI demo storefront. No real-world charge is made.</div>
        {productsQ.isLoading ? <Panel title="Demo catalog"><Loading rows={4} /></Panel> : productsQ.isError ? <Panel title="Demo catalog"><ErrorState retry={() => productsQ.refetch()} /></Panel> : !products.length ? <Panel title="Demo catalog"><EmptyState title="Catalog is empty" copy="No products are currently available from the server." /></Panel> :
          <div className="product-grid">{products.map((product, i) => <article key={product.id} className="product-card" data-testid={`card-product-${product.id}`}>
            <div className="product-art" style={{ '--product-accent': product.accent } as React.CSSProperties}>{i % 3 === 0 ? <Package size={32} /> : i % 3 === 1 ? <Sparkles size={30} /> : <CreditCard size={30} />}<span style={{ position: 'absolute', left: 13, bottom: 11, font: '10px var(--app-font-mono)', opacity: .8 }}>{product.category}</span></div>
            <div className="product-info"><h3>{product.name}</h3><p>{product.description}</p><div className="product-bottom"><span className="product-price">{money(product.priceMinor, product.currency)}</span><button className={`button small${selected?.id === product.id ? ' primary' : ''}`} disabled={!product.available} onClick={() => { setSelected(product); setOrder(null); setResult(null); }} data-testid={`button-select-product-${product.id}`}>{!product.available ? 'Unavailable' : selected?.id === product.id ? <><Check size={12} />Selected</> : 'Choose'}</button></div></div>
          </article>)}</div>}
      </div>
      <aside className="checkout-box"><Panel title="Your order" caption="Buyer confirmation required">
        <div className="panel-body">
          {!selected ? <EmptyState title="Nothing selected yet" copy="Choose a product to review your order." /> : <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 15, marginBottom: 14 }}><div><div style={{ fontWeight: 700, fontSize: 12, color: '#30435b' }}>{selected.name}</div><div className="merchant-meta">{selected.category}</div></div><div className="product-price">{money(selected.priceMinor, selected.currency)}</div></div>
            <div className="field-label">Quantity</div><div className="checkout-quantity" style={{ marginBottom: 18 }}><button aria-label="Decrease quantity" onClick={() => setQuantity(q => Math.max(1, q - 1))} data-testid="button-quantity-decrease">−</button><span className="mono" data-testid="value-quantity">{quantity}</span><button aria-label="Increase quantity" onClick={() => setQuantity(q => Math.min(10, q + 1))} data-testid="button-quantity-increase">+</button><span style={{ color: '#8592a0', fontSize: 10 }}>Limit 10</span></div>
            <div style={{ borderTop: '1px solid #e9edf0', paddingTop: 13, display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><strong>Order total</strong><strong className="mono">{money(selected.priceMinor * quantity, selected.currency)}</strong></div>
            {statusQ.isLoading ? <div className="skeleton" style={{ height: 38, marginTop: 16 }} /> : statusQ.isError ? <div style={{ marginTop: 12 }}><ErrorState retry={() => statusQ.refetch()} message="PayPal readiness could not be checked. Checkout remains unavailable until the server confirms configuration." /></div> : !ready ? <div className="callout" style={{ marginTop: 15 }}><strong>Sandbox checkout not configured</strong><br />PayPal credentials are not ready. No checkout will be simulated. Visit <Link href="/settings" style={{ color: '#315e89', textDecoration: 'underline' }}>Setup guidance</Link> to review readiness.</div> : <button className="button primary" style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} onClick={prepareOrder} disabled={create.isPending} data-testid="button-prepare-order">{create.isPending ? <><LoaderCircle size={14} />Preparing secure order…</> : <><LockKeyhole size={14} />Prepare Sandbox checkout</>}</button>}
            {create.isError && <div className="inline-alert">We could not prepare this order. Try again when the Sandbox service is ready.</div>}
          </>}
          {order && !result && <div style={{ marginTop: 17, borderTop: '1px solid #e9edf0', paddingTop: 15 }}><div className="callout"><strong>Order prepared · {order.id}</strong><br />Review the order on PayPal Sandbox and approve it there. Returning to this page does not itself confirm payment.</div>{order.approveUrl ? <a className="button primary" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} href={order.approveUrl} data-testid="link-approve-paypal">Continue to Sandbox approval <ExternalLink size={13} /></a> : <div className="inline-alert">The server did not provide an approval link. This order cannot be treated as paid.</div>}
            <button className="button small" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={() => refreshOrderStatus(order.id, order.paypalOrderId)} disabled={statusRefreshing} data-testid="button-refresh-order-status">{statusRefreshing ? <><LoaderCircle size={12} />Refreshing…</> : <><RefreshCw size={12} />Refresh verified order status</>}</button></div>}
          {capture.isPending && <div className="callout" style={{ marginTop: 14 }}>Verifying approval with the server…</div>}
          {captureError && <div className="inline-alert" role="alert">{captureError}</div>}
          {result && (result.verified && result.status === 'completed' ? <div className="order-success" style={{ marginTop: 15 }} data-testid="status-checkout-verified"><strong>Payment verified in Sandbox</strong><br />{money(result.amountMinor, result.currency)} · Capture confirmed by PayPilot server.</div> : <div className="callout" style={{ marginTop: 15 }} data-testid="status-checkout-unverified"><strong>Approval not confirmed</strong><br />Server status: {result.status}. A redirect is not proof of payment; no completed purchase is claimed.</div>)}
        </div>
      </Panel></aside>
    </div>
  </div>;
}

function TransactionsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [params, setParams] = useState<{ search?: string; status?: 'completed' | 'pending' | 'failed' }>({});
  const q = useGetTransactions(params);
  const [, setLocation] = useLocation();
  const [selectedId, setSelectedId] = useState(() => new URLSearchParams(window.location.search).get('selected') || '');
  const detail = useGetTransaction(selectedId || 'none', { query: { enabled: Boolean(selectedId), queryKey: getGetTransactionQueryKey(selectedId || 'none') } });
  const transactions = q.data ?? [];
  function runSearch(e: React.FormEvent) { e.preventDefault(); setParams({ ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status: status as 'completed' | 'pending' | 'failed' } : {}) }); }
  return <div className="content">
    <PageHeading eyebrow="Activity ledger" title="Transactions" subtitle="Search and inspect the records available in this workspace." />
    <Panel title="Transaction activity" caption={q.data ? `${q.data.length} records · ${q.data.length ? 'server results' : 'no matching activity'}` : 'Server-backed records'}>
      <div className="panel-body" style={{ paddingBottom: 13 }}>
        <form className="filter-bar" onSubmit={runSearch}><div style={{ position: 'relative', flex: '1 1 240px' }}><Search size={14} style={{ position: 'absolute', left: 12, top: 12, color: '#8a98a7' }} /><input className="field" style={{ paddingLeft: 34 }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search merchant, category or reference" aria-label="Search transactions" data-testid="input-transaction-search" /></div>
          <select className="select-field" value={status} onChange={e => setStatus(e.target.value)} aria-label="Filter transaction status" data-testid="select-transaction-status"><option value="">All statuses</option><option value="completed">Completed</option><option value="pending">Pending</option><option value="failed">Failed</option></select>
          <button className="button primary" type="submit" data-testid="button-apply-filters"><SlidersHorizontal size={13} />Apply</button><button className="button" type="button" onClick={() => { setSearch(''); setStatus(''); setParams({}); }} data-testid="button-clear-filters">Clear</button>
        </form>
      </div>
      {q.isLoading ? <Loading rows={5} /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : !transactions.length ? <EmptyState title="No matching transactions" copy="Try a different search or clear the filters. The interface does not fill gaps with sample records." /> :
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Merchant</th><th>Date</th><th>Category</th><th>Status</th><th style={{ textAlign: 'right' }}>Amount</th><th aria-label="Details" /></tr></thead><tbody>{transactions.map(tx => <tr key={tx.id} data-testid={`row-transaction-${tx.id}`}><td><strong style={{ color: '#2e4058' }}>{tx.merchant}</strong><div className="merchant-meta">{tx.reference || tx.id}</div></td><td>{dateLabel(tx.date)}</td><td>{tx.category}</td><td><span className={statusClass(tx.status)}>{tx.status}</span></td><td className="mono" style={{ textAlign: 'right' }}>{money(tx.amountMinor, tx.currency)}</td><td><button className="button small" onClick={() => { setSelectedId(tx.id); setLocation(`/transactions?selected=${encodeURIComponent(tx.id)}`); }} data-testid={`button-detail-${tx.id}`}>Details</button></td></tr>)}</tbody></table></div>}
    </Panel>
    {selectedId && <div style={{ position: 'fixed', inset: 0, zIndex: 30, background: '#14263b55', display: 'flex', justifyContent: 'flex-end' }} onClick={() => { setSelectedId(''); setLocation('/transactions'); }} role="presentation">
      <section className="panel" style={{ width: 'min(440px,100%)', borderRadius: 0, minHeight: '100%', paddingBottom: 30, overflowY: 'auto', boxShadow: '-12px 0 40px #1c2c3d20' }} onClick={e => e.stopPropagation()} aria-label="Transaction details">
        <header className="panel-head"><div><div className="eyebrow">Transaction record</div><h2 className="panel-title">{detail.data?.merchant ?? 'Details'}</h2></div><button className="button small" onClick={() => { setSelectedId(''); setLocation('/transactions'); }} aria-label="Close details" data-testid="button-close-transaction"><X size={14} /></button></header>
        {detail.isLoading ? <Loading rows={4} /> : detail.isError || !detail.data ? <ErrorState retry={() => detail.refetch()} /> : <TransactionDetails tx={detail.data} />}
      </section>
    </div>}
  </div>;
}
function TransactionDetails({ tx }: { tx: Transaction }) {
  return <div className="panel-body"><div style={{ font: '700 28px var(--app-font-display)', color: '#20344e', margin: '4px 0 8px' }}>{money(tx.amountMinor, tx.currency)}</div><span className={statusClass(tx.status)}>{tx.status}</span>
    <div className="detail-grid"><div className="detail-item"><span>Merchant</span><strong>{tx.merchant}</strong></div><div className="detail-item"><span>Category</span><strong>{tx.category}</strong></div><div className="detail-item"><span>Activity date</span><strong>{dateLabel(tx.date)}</strong></div><div className="detail-item"><span>Source</span><strong>{tx.source}</strong></div><div className="detail-item"><span>Reference</span><strong>{tx.reference || 'Not provided'}</strong></div><div className="detail-item"><span>Transaction ID</span><strong className="mono">{tx.id}</strong></div></div>
    <div className="callout" style={{ marginTop: 18 }}>{tx.description}</div>
  </div>;
}

function AnalyticsPage() {
  const [period, setPeriod] = useState<'week' | 'month' | 'quarter'>('month');
  const q = useGetSpendingAnalytics({ period });
  const data = q.data;
  const max = Math.max(1, ...(data?.categories ?? []).map(c => c.amountMinor));
  return <div className="content">
    <PageHeading eyebrow="Spending intelligence" title="See the shape of spending." subtitle="Compare the selected period with the prior period using available demo activity.">
      <div className="period-switch" role="group" aria-label="Analytics period">{(['week', 'month', 'quarter'] as const).map(item => <button className={period === item ? 'selected' : ''} onClick={() => setPeriod(item)} key={item} aria-pressed={period === item} data-testid={`button-period-${item}`}>{item === 'week' ? 'Week' : item === 'month' ? 'Month' : 'Quarter'}</button>)}</div>
    </PageHeading>
    {q.isLoading ? <Loading rows={5} /> : q.isError || !data ? <Panel title="Spending analytics"><ErrorState retry={() => q.refetch()} /></Panel> : <>
      <div className="metric-grid">
        <div className="metric"><div className="metric-label">Total spend · {data.period}<Wallet size={14} /></div><div className="metric-value" data-testid="value-analytics-total">{money(data.totalSpentMinor, data.currency)}</div><div className="metric-note">Source: {data.sourceLabel}</div></div>
        <div className="metric"><div className="metric-label">Prior period <ArrowLeftRight size={14} /></div><div className="metric-value">{money(data.priorPeriodSpentMinor, data.currency)}</div><div className="metric-note">Comparable previous period</div></div>
        <div className="metric"><div className="metric-label">Period change <Activity size={14} /></div><div className="metric-value">{data.changePercent > 0 ? '+' : ''}{(Number(data.changePercent) || 0).toFixed(1)}%</div><div className={`metric-note${data.changePercent < 0 ? ' positive' : ''}`}>Versus previous period</div></div>
      </div>
      <div className="workspace-grid">
        <Panel title="Weekly movement" caption="Cash flow reported by the selected period"><div className="panel-body"><Chart data={data.activity ?? []} /></div></Panel>
        <Panel title="Spending by category" caption="Share of total spend"><div className="panel-body">{(data.categories ?? []).length ? (data.categories ?? []).map(cat => <div className="category-row" key={cat.category}><div className="category-name">{cat.category}</div><div className="track"><span style={{ width: `${cat.amountMinor / max * 100}%` }} /></div><div className="category-val">{money(cat.amountMinor, cat.currency)}</div></div>) : <EmptyState title="No categories yet" copy="No category breakdown is available for this period." />}</div></Panel>
      </div>
      <div className="footer-note"><SourceTag>{data.sourceLabel}</SourceTag><span style={{ marginLeft: 9 }}>All figures are drawn from this synthetic demo workspace.</span></div>
    </>}
  </div>;
}

function InternationalPage() {
  const [raw, setRaw] = useState('100');
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const numeric = Number(raw);
  const params = useMemo(() => ({ amount: numeric > 0 ? numeric : 1, from, to }), [numeric, from, to]);
  const q = useGetFxEstimate(params, { query: { enabled: numeric > 0 && Number.isFinite(numeric), queryKey: getGetFxEstimateQueryKey(params) } });
  const swap = () => { setFrom(to); setTo(from); };
  return <div className="content">
    <PageHeading eyebrow="Cross-border context" title="Estimate before you convert." subtitle="Indicative rates help with planning. They are not a quote, payment instruction, or guarantee." />
    <div className="workspace-grid">
      <Panel title="Currency estimate" caption="Server-published indicative rate">
        <div className="panel-body">
          <div className="field-wrap"><label className="field-label" htmlFor="fx-amount">Amount</label><input id="fx-amount" type="number" min="0.01" step="0.01" className="field" value={raw} onChange={e => setRaw(e.target.value)} data-testid="input-fx-amount" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 42px 1fr', gap: 9, alignItems: 'end' }}>
            <div><label className="field-label" htmlFor="fx-from">From</label><select className="select-field" id="fx-from" style={{ width: '100%' }} value={from} onChange={e => setFrom(e.target.value)} data-testid="select-fx-from">{['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'AUD', 'CHF'].map(c => <option key={c}>{c}</option>)}</select></div>
            <button className="button" onClick={swap} aria-label="Swap currencies" style={{ justifyContent: 'center', padding: 10 }} data-testid="button-swap-currencies"><ArrowLeftRight size={14} /></button>
            <div><label className="field-label" htmlFor="fx-to">To</label><select className="select-field" id="fx-to" style={{ width: '100%' }} value={to} onChange={e => setTo(e.target.value)} data-testid="select-fx-to">{['USD', 'EUR', 'GBP', 'CAD', 'JPY', 'AUD', 'CHF'].map(c => <option key={c}>{c}</option>)}</select></div>
          </div>
          {!Number.isFinite(numeric) || numeric <= 0 ? <div className="inline-alert">Enter an amount greater than zero.</div> : q.isLoading ? <div className="fx-result"><div className="skeleton" style={{ height: 27, width: '50%' }} /><div className="skeleton" style={{ height: 19, width: '38%', marginTop: 12 }} /></div> : q.isError || !q.data ? <ErrorState retry={() => q.refetch()} /> : <div className="fx-result" data-testid="fx-estimate-result"><div className="eyebrow">Indicative conversion</div><div className="fx-amount">{amount(q.data.amount, q.data.from)}</div><div className="fx-convert">≈ {amount(q.data.convertedAmount, q.data.to)}</div><div className="fx-rate">1 {q.data.from} = {(Number(q.data.rate) || 0).toFixed(5)} {q.data.to}</div><div className="merchant-meta" style={{ marginTop: 11 }}>Rate source: {q.data.rateSource}<br />Updated {dateLabel(q.data.timestamp)}</div><div className="callout" style={{ marginTop: 13 }}>{q.data.feeNote}</div></div>}
        </div>
      </Panel>
      <aside style={{ display: 'grid', gap: 16 }}>
        <Panel title="Read the estimate"><div className="panel-body"><div className="callout"><strong>Indicative only</strong><br />Actual conversion rates and fees can differ at the time of a transaction. PayPilot AI does not execute currency conversion.</div><div style={{ marginTop: 15, display: 'flex', gap: 9, alignItems: 'flex-start', color: '#718197', fontSize: 11, lineHeight: 1.6 }}><ShieldCheck size={15} color="#567e9e" />Estimate details are provided by the workspace server, including its source and fee note.</div></div></Panel>
        <div className="callout"><strong>Sandbox context</strong><br />This estimate supports learning about cross-border payment costs. It does not access a live balance or account.</div>
      </aside>
    </div>
  </div>;
}

function PayPalCheck() {
  const check = useCheckPayPalSandbox();
  const result = check.data;
  const waiting = (check.error as { status?: number } | null)?.status === 429;
  return <div style={{ padding: '2px 0 16px 29px' }}>
    <button className="button small" onClick={() => check.mutate()} disabled={check.isPending} data-testid="button-paypal-check">{check.isPending ? <><LoaderCircle size={12} />Checking PayPal…</> : 'Run PayPal Sandbox check'}</button>
    <span style={{ marginLeft: 10, color: '#8592a0', fontSize: 10 }}>Creates a $1.00 test order that is never approved or captured.</span>
    {result && <div className={result.ok ? 'order-success' : 'callout'} style={{ marginTop: 10 }} role="status" data-testid="status-paypal-check">
      <strong>{result.ok ? 'Sandbox check passed' : 'Needs attention'}</strong> <span className="mono" style={{ fontSize: 10 }}>({result.code})</span><br />{result.message}
      {result.missing?.length ? <><br />Missing: <span className="mono">{result.missing.join(', ')}</span></> : null}
      {result.configuredMerchantHint ? <><br />Configured merchant ID: <span className="mono">{result.configuredMerchantHint}</span></> : null}
      {result.paypalMerchantHint && !result.ok ? <><br />Merchant ID PayPal reports for this app: <span className="mono">{result.paypalMerchantHint}</span></> : null}
      {result.paypalStatus ? <><br />PayPal HTTP status: <span className="mono">{result.paypalStatus}</span></> : null}
    </div>}
    {check.isError && <div className="inline-alert" role="alert" style={{ marginTop: 10 }}>{waiting ? 'The check ran moments ago. Wait a few seconds and try again.' : 'The check could not be run. The server may be restarting; try again.'}</div>}
  </div>;
}

type RuntimeDiagnostics = {
  status: string;
  ai: { configured: boolean; provider: string; model: string | null };
  paypal: { configured: boolean; environment: string };
  database: { configured: boolean; reachable: boolean; ordersTableAvailable: boolean; errorCode: string | null };
  dataScope: string;
  warnings: string[];
};

function SettingsPage() {
  const q = useGetIntegrationStatus();
  const status = q.data;
  const [diagnostics, setDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(true);
  const [diagnosticsError, setDiagnosticsError] = useState('');
  const [diagnosticsRefresh, setDiagnosticsRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setDiagnosticsLoading(true);
    fetch('/api/settings/diagnostics')
      .then(async response => {
        if (!response.ok) throw new Error(`Diagnostics returned HTTP ${response.status}`);
        return response.json() as Promise<RuntimeDiagnostics>;
      })
      .then(value => { if (active) { setDiagnostics(value); setDiagnosticsError(''); } })
      .catch(error => { if (active) setDiagnosticsError(error instanceof Error ? error.message : 'Diagnostics unavailable'); })
      .finally(() => { if (active) setDiagnosticsLoading(false); });
    return () => { active = false; };
  }, [diagnosticsRefresh]);
  function readiness(label: string, ok: boolean | undefined, readyLabel = 'Ready') {
    return <span className={`readiness${ok ? '' : ' off'}`}><span className="dot" style={{ background: ok ? '#64a487' : '#c5a462', boxShadow: 'none' }} />{ok ? readyLabel : 'Needs setup'}</span>;
  }
  return <div className="content">
    <PageHeading eyebrow="Workspace configuration" title="Trust starts with transparency." subtitle="Review connection readiness without exposing credentials or changing server configuration." />
    {q.isLoading ? <Loading rows={5} /> : q.isError || !status ? <Panel title="Readiness status"><ErrorState retry={() => q.refetch()} /></Panel> : <>
      <div className="workspace-grid">
        <Panel title="Integration readiness" caption={`Environment · ${status.environment}`}>
          <div className="panel-body">
            <div className="setting-row"><div style={{ display: 'flex', gap: 12 }}><Sparkles size={17} color="#6083a5" /><div><div className="setting-name">AI assistant</div><div className="setting-detail">{status.aiConfigured ? 'API key is configured; availability depends on provider quota and rate limits.' : 'The assistant may use server-provided demo fallback responses.'}</div></div></div>{readiness('AI', status.aiConfigured, 'Key set')}</div>
            <div className="setting-row"><div style={{ display: 'flex', gap: 12 }}><CreditCard size={17} color="#6083a5" /><div><div className="setting-name">PayPal Sandbox</div><div className="setting-detail">{status.paypalConfigured ? 'Sandbox variables are set. Run the PayPal check below to verify OAuth and the receiving merchant.' : 'Checkout remains unavailable until Sandbox credentials are configured.'}</div></div></div>{readiness('PayPal', status.paypalConfigured, 'Variables set')}</div>
            <PayPalCheck />
            <div className="setting-row"><div style={{ display: 'flex', gap: 12 }}><Database size={17} color="#6083a5" /><div><div className="setting-name">Database</div><div className="setting-detail">{status.databaseConfigured ? 'A database URL is configured. Actual connectivity and table access are checked below.' : 'Database readiness is not reported as configured.'}</div></div></div>{readiness('Database', status.databaseConfigured, 'URL set')}</div>
            <div className="setting-row"><div style={{ display: 'flex', gap: 12 }}><Globe2 size={17} color="#6083a5" /><div><div className="setting-name">Activity source</div><div className="setting-detail">{status.accountDataLabel}</div></div></div><SourceTag>{status.environment}</SourceTag></div>
          </div>
        </Panel>
        <aside style={{ display: 'grid', gap: 16 }}>
          <Panel title="Setup guidance"><div className="panel-body"><div className="callout"><strong>Configuration belongs on the server.</strong><br />Add credentials through Replit Secrets, then reload readiness. Never paste secrets into this interface or use live PayPal credentials for the demo.</div>
            <ol style={{ paddingLeft: 18, margin: '16px 0 0', color: '#6e7d90', fontSize: 11, lineHeight: 1.8 }}><li>Set the PayPal Sandbox REST app client ID and secret.</li><li>Set the expected Sandbox merchant ID and confirm the environment is sandbox.</li><li>Test with a separate Sandbox buyer account; only verified server capture confirms payment.</li></ol>
          </div></Panel>
          <Panel title="Product boundaries"><div className="panel-body"><div className="merchant-line" style={{ marginBottom: 14 }}><ShieldCheck size={17} color="#4c816b" /><span className="setting-name">Independent demo workspace</span></div><p className="subtitle" style={{ fontSize: 11 }}>PayPilot AI is not an official PayPal product. Displayed transaction activity is synthetic unless the server explicitly identifies another source.</p><div className="status-pill"><span className="dot" />SANDBOX ENVIRONMENT</div></div></Panel>
        </aside>
      </div>
    </>}
    <Panel title="Live runtime diagnostics" caption="Connectivity and schema checks; no credentials are displayed">
      <div className="panel-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div className="subtitle" style={{ fontSize: 11 }}>Checks the database connection and whether the PayPilot orders table exists.</div>
          <button className="button small" onClick={() => setDiagnosticsRefresh(value => value + 1)} disabled={diagnosticsLoading}><RefreshCw size={12} />Refresh checks</button>
        </div>
        {diagnosticsLoading ? <Loading rows={2} /> : diagnosticsError ? <div className="inline-alert" role="alert">{diagnosticsError}</div> : diagnostics ? <>
          <div className="setting-row"><div><div className="setting-name">Database network / authentication</div><div className="setting-detail">{diagnostics.database.reachable ? 'PostgreSQL accepted a SELECT 1 query.' : 'The server could not complete a database query.'}</div></div>{readiness('Database', diagnostics.database.reachable, 'Reachable')}</div>
          <div className="setting-row"><div><div className="setting-name">PayPilot orders table</div><div className="setting-detail">{diagnostics.database.ordersTableAvailable ? 'paypilot_orders can be queried.' : 'The table is missing or the database role cannot read it. Run the schema setup script after confirming the target database.'}</div></div>{readiness('Orders table', diagnostics.database.ordersTableAvailable, 'Available')}</div>
          {diagnostics.database.errorCode && <div className="callout" style={{ marginTop: 10 }}>Database diagnostic code: <strong className="mono">{diagnostics.database.errorCode}</strong>. This is a safe error code, not a credential or connection string.</div>}
          {diagnostics.warnings.map((warning, index) => <div className="merchant-meta" key={index} style={{ marginTop: 8 }}>• {warning}</div>)}
        </> : <EmptyState title="Diagnostics not available" copy="Refresh to retry the server-side checks." />}
      </div>
    </Panel>
    <div className="footer-note">Readiness flags are returned by the server. This screen does not display or store integration secrets.</div>
  </div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch>
    <Route path="/" component={OverviewPage} />
    <Route path="/assistant" component={AssistantPage} />
    <Route path="/checkout" component={CheckoutPage} />
    <Route path="/transactions" component={TransactionsPage} />
    <Route path="/analytics" component={AnalyticsPage} />
    <Route path="/international" component={InternationalPage} />
    <Route path="/settings" component={SettingsPage} />
    <Route component={NotFound} />
  </Switch></Shell></ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;
