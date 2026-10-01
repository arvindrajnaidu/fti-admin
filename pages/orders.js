import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { withAuth } from '../lib/withAuth';
import { STANDARD_RANGES, isCustomRangeLabel, rangeQueryParams } from '../lib/dateRange';

// The shared set plus All, which ops needs here to reach orders older than a
// year without hand-picking a custom range.
const ORDER_RANGES = [...STANDARD_RANGES.filter((r) => r !== 'Custom'), 'All', 'Custom'];
import { Banner, Button, Input, Loader } from '@cloudflare/kumo';
import { Receipt, EnvelopeSimple, XCircle, PlusCircle, DownloadSimple, WhatsappLogo, Clock, Gift } from '@phosphor-icons/react';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { TableShell, Th, Tr, Td, Pill, Dash, IconButton } from '../components/data/DataTable';
import { Modal } from '../components/layout/Modal';
import { ConfirmDeliveryDetailsModal } from '../components/orders/ConfirmDeliveryDetailsModal';
import { InternalNotes } from '../components/orders/InternalNotes';
import useIsMobile from '../lib/useIsMobile';
import { formatRecipientPhone } from '../lib/phoneFormat';
import { stripNotesSuffix } from '../lib/orderItems';
import { buildMessage, buildWaMeUrl } from '../lib/whatsappTemplates';
import { MapsPreview } from '../components/orders/MapsPreview';
import {
  effectiveDeliveryTiming,
  formatCurrentAddress,
  formatTravelerDeliveryLines,
  isTravelerOrder,
  formatEffectiveDeliveryTime,
  mapsUrlForOrder,
  stripHandoffSuffix,
} from '../lib/orderDelivery';
import { orderUsd, paiseToUsd } from '../lib/currency';
import { formatOrderDistance } from '../lib/orderDistance';

// Pill rendered next to the dispatch-status pill for the recipient
// contact state. Returns null when there's no contact attempt yet — most
// legacy rows. Phase 1 surfaces three states: WA sent, Confirmed, and a
// future "No response" (manual, not auto-flipped — see impl-notes).
function renderContactPill(contact) {
  if (!contact) return null;
  if (contact.status === 'confirmed') return <Pill tone="success">Confirmed</Pill>;
  if (contact.status === 'pending') return <Pill tone="warn">WA sent</Pill>;
  return null;
}

// Derive an E.164-ish phone string for wa.me even when older orders only
// stored recipientPhone with spaces (e.g. "+91 98765 43210"). Strip all
// whitespace; the result is usable by buildWaMeUrl which already strips "+".
function getWaPhone(recipient) {
  if (!recipient) return null;
  if (recipient.recipientPhoneE164) return recipient.recipientPhoneE164;
  if (recipient.recipientPhone) return recipient.recipientPhone.replace(/\s+/g, '');
  return null;
}

// Only treat `recipientPhoneIsWhatsApp === false` as a meaningful "no WA"
// signal for non-IN recipients. WhatsApp penetration in India is ~95%
// and the cart's WA checkbox often gets left unchecked for IN — flagging
// almost every IN order as "no WhatsApp — call instead" was wrong.
function senderMarkedNoWhatsApp(order) {
  if (order?.recipient?.recipientPhoneIsWhatsApp !== false) return false;
  const country = order?.recipient?.recipientPhoneCountry;
  return !!country && country !== 'IN';
}

function waButtonTooltip(order) {
  const c = order?.recipientContact;
  if (senderMarkedNoWhatsApp(order)) return 'Recipient marked as no WhatsApp — call instead';
  if (c?.status === 'confirmed') return 'Confirmed — re-send WhatsApp';
  if (c?.status === 'pending' && c?.whatsappSentAt) return 'Re-send WhatsApp';
  return 'Send WhatsApp confirmation';
}

function waIconColor(order) {
  const c = order?.recipientContact;
  if (c?.status === 'confirmed') return 'text-success';
  if (c?.status === 'pending') return 'text-warn';
  if (senderMarkedNoWhatsApp(order)) return 'text-ink-400';
  return 'text-success';
}

// Strip the "[Risk Score: NN, Country XX]" suffix the customer app appends
// to senderName — risk is surfaced separately in the Payment panel.
function cleanSenderName(raw) {
  return (raw || '').replace(/\s*\[Risk Score:[^\]]*\]\s*$/, '').trim() || 'N/A';
}

export default function OrdersPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/login');
    } catch (err) {
      console.error('Logout failed:', err);
      setLoggingOut(false);
    }
  };
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [environment, setEnvironment] = useState('dev');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [showSenderModal, setShowSenderModal] = useState(false);
  const [selectedSender, setSelectedSender] = useState(null);
  const [senderOrders, setSenderOrders] = useState([]);
  const [senderModalPage, setSenderModalPage] = useState(1);
  const [senderOrdersLoading, setSenderOrdersLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [timeRange, setTimeRange] = useState('1 month');

  // Email modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailOrder, setEmailOrder] = useState(null);
  const [emailFrom, setEmailFrom] = useState('support@foodtoindia.com');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailResult, setEmailResult] = useState(null);

  // Unified "Confirm delivery details" modal (shared extracted component).
  const [confirmOrder, setConfirmOrder] = useState(null);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const isCustomRange = isCustomRangeLabel(timeRange);
  const [statusFilter, setStatusFilter] = useState('all');

  // Cancel order modal state
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelOrder, setCancelOrder] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSendEmail, setCancelSendEmail] = useState(true);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [cancelResult, setCancelResult] = useState(null);

  // Store credit modal state
  const [showStoreCreditModal, setShowStoreCreditModal] = useState(false);
  const [storeCreditOrder, setStoreCreditOrder] = useState(null);
  const [storeCreditAmount, setStoreCreditAmount] = useState('');
  const [storeCreditReason, setStoreCreditReason] = useState('');
  const [storeCreditSubmitting, setStoreCreditSubmitting] = useState(false);
  const [storeCreditResult, setStoreCreditResult] = useState(null);

  useEffect(() => {
    fetchOrders();
    fetchEnvironment();
  }, [search, currentPage, timeRange, customStartDate, customEndDate, statusFilter]);

  const fetchEnvironment = async () => {
    try {
      const response = await fetch('/api/environment');
      if (response.ok) {
        const data = await response.json();
        setEnvironment(data.environment);
      }
    } catch (err) {
      console.error('Failed to fetch environment:', err);
    }
  };

  // Date-filter query params for the selected chip. Custom boundaries resolve
  // in the viewer's browser so picked days mean the same thing on a UTC server;
  // YTD rides the same custom-range path. See lib/dateRange.
  const dateParams = () =>
    rangeQueryParams(timeRange, {
      custom: { from: customStartDate, to: customEndDate },
    }) || {};

  const fetchOrders = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: 25,
        page: currentPage,
        ...(search && { search }),
        ...(forceRefresh && { forceRefresh: 'true' }),
        // Custom range boundaries are resolved here, in the viewer's browser,
        // so the picked days mean the same thing on a UTC server. See lib/dateRange.
        ...dateParams(),
        ...(statusFilter !== 'all' && { status: statusFilter }),
      });
      const response = await fetch(`/api/orders?${params}`);

      if (!response.ok) {
        // Try to get detailed error message from API
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || 'Failed to fetch orders';
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setOrders(data.orders || []);
      setTotalPages(data.totalPages || 1);
      setTotalOrders(data.total || 0);

      // Phase F: scan for orders flagged with pendingSenderNotification
      // and fire-and-forget the email send. The endpoint claims the flag
      // in a Firestore transaction so concurrent tabs don't dupe.
      const pending = (data.orders || []).filter((o) => o.recipientContact?.pendingSenderNotification === true);
      pending.forEach((o) => {
        fetch('/api/whatsapp/send-time-change-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: o.userId, orderId: o.id }),
        }).catch((e) => console.warn('Time-change email trigger failed:', e));
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchOrders(true); // Force refresh
    } finally {
      setRefreshing(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setCurrentPage(1); // Reset to first page on search
    setSearch(searchInput);
  };

  const handlePageChange = (page) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages = [];
    const maxPagesToShow = 5;

    if (totalPages <= maxPagesToShow) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always include first page
      pages.push(1);

      // Calculate range around current page
      let startPage = Math.max(2, currentPage - 1);
      let endPage = Math.min(totalPages - 1, currentPage + 1);

      // Add ellipsis if needed
      if (startPage > 2) {
        pages.push('...');
      }

      // Add pages around current
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      // Add ellipsis if needed
      if (endPage < totalPages - 1) {
        pages.push('...');
      }

      // Always include last page
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  const renderPagination = () => (
    <div style={{
      marginTop: '20px',
      marginBottom: '20px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      gap: '5px',
      flexWrap: 'wrap'
    }}>
      {/* Previous Button */}
      <button
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
        style={{
          padding: '8px 12px',
          fontSize: '14px',
          backgroundColor: currentPage === 1 ? '#eef0f3' : '#3f3ccc',
          color: currentPage === 1 ? '#636a78' : 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
        }}
      >
        &lt;&lt; Prev
      </button>

      {/* Page Numbers */}
      {getPageNumbers().map((page, index) => (
        page === '...' ? (
          <span key={`ellipsis-${index}`} style={{ padding: '8px 4px', color: '#636a78' }}>
            ...
          </span>
        ) : (
          <button
            key={page}
            onClick={() => handlePageChange(page)}
            style={{
              padding: '8px 12px',
              fontSize: '14px',
              backgroundColor: currentPage === page ? '#3f3ccc' : 'white',
              color: currentPage === page ? 'white' : '#3f3ccc',
              border: currentPage === page ? 'none' : '1px solid #3f3ccc',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: currentPage === page ? 'bold' : 'normal',
              minWidth: '40px',
            }}
          >
            {page}
          </button>
        )
      ))}

      {/* Next Button */}
      <button
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        style={{
          padding: '8px 12px',
          fontSize: '14px',
          backgroundColor: currentPage === totalPages ? '#eef0f3' : '#3f3ccc',
          color: currentPage === totalPages ? '#636a78' : 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
          fontWeight: 'bold',
        }}
      >
        Next &gt;&gt;
      </button>
    </div>
  );

  // Amounts in Firebase are stored in INR paise. Rate resolution is delegated
  // to lib/currency.js so this page has no FX opinion of its own: it resolves
  // stamped rate -> rate derived from the order's own Stripe charge -> the
  // dated table. This replaced a local DEFAULT_CONVERSION of 9500 that agreed
  // with nothing else in either repo and was reached by the 21 orders from
  // 2021 that predate Stripe (they rendered ~27% low).
  const formatCurrency = (amount, order = null) => {
    if (!amount) return '$0.00';
    return `$${paiseToUsd(parseFloat(amount), order).toFixed(2)}`;
  };

  // The exact amount the customer's card was charged. paymentIntent.amount
  // is USD cents straight from Stripe — the ground truth, no INR→USD
  // conversion guesswork. Use this anywhere we show "what they paid"
  // (orders list, CSV, sub-modals). formatCurrency(totalAmount) without
  // the order arg silently used DEFAULT_CONVERSION and produced a wrong
  // number that didn't match the order-detail modal.
  //
  // Fallback: orders fully covered by store/referral credit may have no
  // paymentIntent — fall back to the converted order total.
  const formatAmountPaid = (order) => {
    if (order?.paymentIntent?.amount) {
      return `$${(order.paymentIntent.amount / 100).toFixed(2)}`;
    }
    return formatCurrency(order?.totalAmount, order);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Delivery type + the effective requested time (ops > recipient > sender
  // precedence, via effectiveDeliverAt). 'asap' / null => ASAP (now); a
  // number => Scheduled (later) at that time. Used by the order-detail header
  // and the CSV export so we can compare the requested slot vs the dispatch
  // time, not just vs order-placed.
  const deliveryInfo = (order) => {
    const timing = effectiveDeliveryTiming(order);
    if (timing.mode === 'scheduled' && timing.scheduledFor) {
      const windowTime = timing.mealWindow ? formatEffectiveDeliveryTime(order) : null;
      return {
        type: 'Scheduled',
        time: windowTime ? `${formatDate(timing.scheduledFor)} · ${windowTime}` : formatDate(timing.scheduledFor),
      };
    }
    return { type: 'ASAP', time: '' };
  };

  const getRecipientCity = (order) => {
    const loc = order.recipient?.location;
    if (!loc) return 'N/A';

    // Preferred: structured Google address_components when available
    // (recipients saved after EditRecipientDialog stores them).
    if (loc.addressComponents && loc.addressComponents.length) {
      const get = (type) => {
        const c = loc.addressComponents.find(
          (x) => x.types && x.types.includes(type)
        );
        return c ? c.long_name : '';
      };
      const city = get('locality') || get('administrative_area_level_2');
      const state = get('administrative_area_level_1');
      if (city && state) return `${city}, ${state}`;
      if (city) return city;
    }

    // Fallback: parse formattedAddress. The user-app overloads this field
    // with a ", Landmark: ..." suffix to render the landmark inside the
    // Slack ops template — strip that suffix before guessing City/State
    // by position, otherwise rows show "India, Landmark: ..." or
    // "Tamil Nadu 600119, India" instead of the actual city.
    if (loc.formattedAddress) {
      const cleaned = loc.formattedAddress
        .replace(/,\s*Landmark:.*$/i, '')
        .trim();
      const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean);

      // Typical Indian format: ["Area", "Locality", "City", "State pincode", "India"]
      if (parts.length >= 4) {
        const city = parts[parts.length - 3];
        const state = parts[parts.length - 2];
        return `${city}, ${state}`;
      }
      if (parts.length === 3) {
        return `${parts[0]}, ${parts[1]}`;
      }
    }

    if (loc.city) return loc.city;
    return 'N/A';
  };

  const openOrderDetails = (order) => {
    setSelectedOrder(order);
    setShowModal(true);
  };

  // Auto-open the order details modal when arriving from the dispatch
  // page with `?openOrder=<id>`. Waits for orders to load, then finds
  // the matching one. Strips the param after opening so a refresh
  // doesn't re-trigger.
  useEffect(() => {
    if (!router.isReady) return;
    const targetId = router.query.openOrder;
    if (!targetId || !orders.length) return;
    const match = orders.find((o) => o.id === targetId);
    if (!match) return;
    openOrderDetails(match);
    const { openOrder, ...rest } = router.query;
    router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, orders, router.query.openOrder]);

  const closeModal = () => {
    setShowModal(false);
    setSelectedOrder(null);
  };

  const convertToCSV = (data) => {
    if (!data || data.length === 0) return '';

    // CSV Headers
    const headers = [
      'Order ID',
      'Date',
      'Sender Name',
      'Sender Email',
      'Recipient Name',
      'Recipient Phone',
      'Recipient City',
      'Recipient Full Address',
      'Restaurant',
      'Total Items',
      'Total Amount',
      'Payment Method',
      'Status',
      'Item Details',
      'Notes',
      'Delivery Type',
      'Requested Delivery Time',
      'Dispatched Time',
      'Has Map Pin',
      'Map Pin',
      'New vs Repeat',
      'Recipient Order #'
    ];

    // Helper to escape CSV values
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const stringValue = String(value);
      // Escape double quotes and wrap in quotes if contains comma, newline, or quote
      if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    // Create CSV rows
    const rows = data.map(order => {
      // Format line items as a readable string
      let itemDetails = '';

      // Try multiple ways to extract line items due to data structure variations
      if (order.lineItems) {
        if (typeof order.lineItems === 'object' && Object.keys(order.lineItems).length > 0) {
          try {
            itemDetails = Object.entries(order.lineItems)
              .map(([itemId, item]) => {
                // Handle case where item might be null/undefined
                if (!item) return null;

                // Handle different item structures
                const itemName = stripNotesSuffix(item.name) || item.itemName || 'Unknown Item';
                const itemQty = item.quantity || item.qty || 1;
                // Variant names (e.g. "250 Gms") ride on item.variants -
                // without them "Bento Cake" is ambiguous for ops re-ordering.
                const variantNames = Array.isArray(item.variants) && item.variants.length > 0
                  ? ` [${item.variants.map(v => v?.name).filter(Boolean).join(', ')}]`
                  : '';
                return `${itemName}${variantNames} (Qty: ${itemQty})`;
              })
              .filter(item => item !== null) // Remove null entries
              .join('; ');
          } catch (err) {
            console.log(`Error parsing lineItems for order ${order.id}:`, err);
            itemDetails = '[Error parsing items]';
          }
        }
      }

      // If still empty, log for debugging
      if (!itemDetails && order.lineItems) {
        console.log(`Order ${order.id} has lineItems but no details extracted:`,
                    typeof order.lineItems,
                    Object.keys(order.lineItems || {}).length);
      }

      return [
        escapeCSV(order.id),
        escapeCSV(formatDate(order.createdAt)),
        escapeCSV(order.senderName || ''),
        escapeCSV(order.senderEmail || ''),
        escapeCSV(order.recipient?.name || ''),
        escapeCSV(formatRecipientPhone(order.recipient)),
        escapeCSV(getRecipientCity(order)),
        escapeCSV((formatCurrentAddress(order).lines || []).join(', ')),
        escapeCSV(order.restaurantName || ''),
        escapeCSV(Object.keys(order.lineItems || {}).length),
        escapeCSV(formatAmountPaid(order)),
        escapeCSV(order.paymentMethod || (order.paymentProvider === 'store_credit' ? 'Store Credit' : '')),
        escapeCSV(order.status || 'pending'),
        escapeCSV(itemDetails || '[No items]'),
        escapeCSV(order.notes || ''),
        escapeCSV(deliveryInfo(order).type),
        escapeCSV(deliveryInfo(order).time),
        escapeCSV(order.dispatchedAt ? formatDate(order.dispatchedAt) : ''),
        escapeCSV(mapsUrlForOrder(order) ? 'Yes' : 'No'),
        escapeCSV(mapsUrlForOrder(order) || ''),
        // _recipientOrdinal is stamped in handleDownload from the full
        // all-time order history (1 = recipient's first-ever order).
        escapeCSV(order._recipientOrdinal == null ? '' : (order._recipientOrdinal === 1 ? 'New' : 'Repeat')),
        escapeCSV(order._recipientOrdinal == null ? '' : order._recipientOrdinal)
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  };

  const downloadCSV = (csvContent, filename) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      // Fetch ALL orders matching the search and date filters (no pagination limit)
      const params = new URLSearchParams({
        limit: 99999, // Request all orders
        page: 1,
        ...(search && { search }),
        // Same viewer-timezone boundaries as fetchOrders, so the CSV export
        // covers exactly the rows shown on screen.
        ...dateParams(),
      });

      const response = await fetch(`/api/orders?${params}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || 'Failed to fetch orders';
        throw new Error(errorMessage);
      }

      const data = await response.json();
      const allOrders = data.orders || [];

      if (allOrders.length === 0) {
        alert('No orders to download');
        return;
      }

      // All-time first-time vs repeat: fetch the FULL order set (no date /
      // search filter) so each recipient's complete history is known, then
      // stamp each export row's ordinal among that recipient's orders.
      // Same cached endpoint, so this is cheap. Non-fatal if it fails.
      try {
        const allResp = await fetch('/api/orders?limit=99999&page=1');
        if (allResp.ok) {
          const everyOrder = (await allResp.json()).orders || [];
          const phoneKey = (o) => {
            const r = o.recipient || {};
            if (r.recipientPhoneE164) return r.recipientPhoneE164;
            const d = String(r.recipientPhone || '').replace(/\D/g, '');
            return d ? d.slice(-10) : null;
          };
          const ts = (o) => new Date(o.createdAt || 0).getTime();
          const timeline = {};
          everyOrder.forEach((o) => {
            const k = phoneKey(o);
            if (!k) return;
            (timeline[k] = timeline[k] || []).push(ts(o));
          });
          allOrders.forEach((o) => {
            const k = phoneKey(o);
            if (!k) { o._recipientOrdinal = null; return; }
            const t = ts(o);
            o._recipientOrdinal = (timeline[k] || []).filter((x) => x < t).length + 1;
          });
        }
      } catch (e) {
        // Export still works without the first-time/repeat columns.
        console.warn('first-time/repeat annotation skipped:', e?.message);
      }

      // Convert to CSV and download
      const csvContent = convertToCSV(allOrders);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

      // Build filename with filters
      let filenameParts = ['orders'];
      if (search) filenameParts.push(search);
      if (isCustomRange && customStartDate && customEndDate) {
        filenameParts.push(`${customStartDate}_to_${customEndDate}`);
      } else if (timeRange !== 'All') {
        filenameParts.push(timeRange.toLowerCase().replace(/\s+/g, '_'));
      }
      filenameParts.push(timestamp);
      const filename = filenameParts.join('_') + '.csv';

      downloadCSV(csvContent, filename);

      alert(`Successfully downloaded ${allOrders.length} orders`);
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleSenderClick = async (senderEmail, senderName) => {
    // Show modal immediately with loading state
    setSelectedSender({ email: senderEmail, name: senderName });
    setSenderModalPage(1);
    setSenderOrders([]);
    setSenderOrdersLoading(true);
    setShowSenderModal(true);

    try {
      // Fetch all orders for this sender in background
      const params = new URLSearchParams({
        limit: 99999,
        page: 1,
        search: senderEmail,
      });

      const response = await fetch(`/api/orders?${params}`);
      if (response.ok) {
        const data = await response.json();
        setSenderOrders(data.orders || []);
      } else {
        alert('Failed to load sender orders');
        closeSenderModal();
      }
    } catch (err) {
      console.error('Error fetching sender orders:', err);
      alert('Failed to load sender orders');
      closeSenderModal();
    } finally {
      setSenderOrdersLoading(false);
    }
  };

  const closeSenderModal = () => {
    setShowSenderModal(false);
    setSelectedSender(null);
    setSenderOrders([]);
    setSenderModalPage(1);
    setSenderOrdersLoading(false);
  };

  const openEmailModal = (order, e) => {
    if (e) e.stopPropagation();
    setEmailOrder(order);
    setEmailFrom('support@foodtoindia.com');
    setEmailBody(`Hi ${order.senderName ? order.senderName.split(' ')[0] : ''},\n\nWe're reaching out regarding your recent order to ${order.recipient?.name || 'your recipient'}.\n\n`);
    setEmailResult(null);
    setShowEmailModal(true);
  };

  const closeEmailModal = () => {
    setShowEmailModal(false);
    setEmailOrder(null);
    setEmailBody('');
    setEmailResult(null);
    setEmailSending(false);
  };

  const handleSendOrderEmail = async () => {
    if (!emailBody.trim() || !emailOrder) return;
    setEmailSending(true);
    setEmailResult(null);

    const lineItems = emailOrder.lineItems ? Object.values(emailOrder.lineItems) : [];
    const orderRef = {
      orderId: emailOrder.id,
      date: formatDate(emailOrder.createdAt),
      recipientName: emailOrder.recipient?.name || 'N/A',
      recipientPhone: formatRecipientPhone(emailOrder.recipient) || 'N/A',
      restaurantName: emailOrder.restaurantName || 'N/A',
      items: lineItems.map(item => ({
        name: stripNotesSuffix(item.name) || 'Unknown Item',
        quantity: item.quantity || 1,
      })),
      notes: emailOrder.notes || '',
    };

    try {
      const response = await fetch('/api/order-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: emailOrder.senderEmail,
          from: emailFrom,
          subject: `Regarding: Order to ${emailOrder.recipient?.name || 'Recipient'}`,
          body: emailBody,
          orderRef,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setEmailResult({ success: true, message: 'Email sent successfully!' });
        setTimeout(closeEmailModal, 2000);
      } else {
        setEmailResult({ success: false, message: data.message || data.error || 'Failed to send email' });
      }
    } catch (err) {
      setEmailResult({ success: false, message: err.message || 'Failed to send email' });
    } finally {
      setEmailSending(false);
    }
  };

  const handleDownloadSenderOrders = () => {
    if (senderOrders.length === 0) {
      alert('No orders to download');
      return;
    }

    const csvContent = convertToCSV(senderOrders);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `orders_${selectedSender.email}_${timestamp}.csv`;

    downloadCSV(csvContent, filename);
    alert(`Successfully downloaded ${senderOrders.length} orders for ${selectedSender.name}`);
  };

  // WhatsApp recipient-confirmation send. We need to open the wa.me tab
  // synchronously with the click so popup blockers stay quiet, then fill
  // in the URL once the server returns a (re-used or fresh) token.
  const handleSendWhatsApp = async (order, e) => {
    if (e) e.stopPropagation();
    const phoneE164 = getWaPhone(order?.recipient);
    if (!phoneE164) {
      window.alert('No phone on file for this recipient — cannot send WhatsApp.');
      return;
    }

    const win = window.open('', '_blank');
    try {
      const resp = await fetch('/api/whatsapp/log-sent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: order.userId, orderId: order.id }),
      });
      if (!resp.ok) throw new Error(`log-sent failed: ${resp.status}`);
      const { confirmationPageUrl } = await resp.json();

      const senderFirstName = (order.senderName || '').split(' ')[0] || 'Your friend';
      const recipient = order.recipient || {};
      const recipientDoorNo = stripHandoffSuffix(recipient.doorNo);
      const fullAddress = [recipientDoorNo, recipient.addressLine, recipient.landmark, recipient.location?.formattedAddress]
        .filter(Boolean).join('\n') || null;
      const hasFullAddress = !!(recipientDoorNo && recipient.addressLine);
      const areaCity = recipient.location?.formattedAddress || '';

      const timing = effectiveDeliveryTiming(order);
      const message = buildMessage({
        recipientName: recipient.name || 'there',
        senderFirstName,
        restaurantName: order.restaurantName || 'a restaurant',
        scheduledForMs: timing.mode === 'scheduled' ? timing.scheduledFor : null,
        mealWindow: timing.mode === 'scheduled' ? timing.mealWindow || null : null,
        fullAddress: hasFullAddress ? fullAddress : null,
        areaCity: hasFullAddress ? null : areaCity,
        profileAddress: null, // phase 1: no profile lookup
        confirmationUrl: confirmationPageUrl,
      });
      const waUrl = buildWaMeUrl(phoneE164, message);
      if (win) win.location.href = waUrl;

      // Trigger a soft refresh so the row's WA-sent pill appears.
      fetchOrders(true);
    } catch (err) {
      console.error('Send WhatsApp failed:', err);
      if (win) win.close();
      window.alert('Could not send WhatsApp — please try again.');
    }
  };

  // After the shared confirm modal saves — optimistically patch the open
  // order-detail modal, then refresh the list in the background.
  const handleConfirmSaved = ({ orderId, confirmedAddress, scheduledFor, mealWindow, markAsConfirmed }) => {
    if (selectedOrder?.id === orderId) {
      setSelectedOrder((prev) => {
        const nextRC = { ...(prev.recipientContact || {}) };
        nextRC.confirmedAddress = confirmedAddress;
        if (scheduledFor != null) {
          nextRC.opsConfirmedTimeSlot = scheduledFor;
          if (mealWindow) nextRC.opsConfirmedMealWindow = mealWindow;
          else delete nextRC.opsConfirmedMealWindow;
        }
        if (markAsConfirmed) nextRC.status = 'confirmed';
        return { ...prev, recipientContact: nextRC };
      });
    }
    fetchOrders(true);
  };

  // Cancel order handlers
  const openCancelModal = (order, e) => {
    if (e) e.stopPropagation();
    setCancelOrder(order);
    setCancelReason('');
    setCancelSendEmail(true);
    setCancelResult(null);
    setCancelSubmitting(false);
    setShowCancelModal(true);
  };

  const closeCancelModal = () => {
    setShowCancelModal(false);
    setCancelOrder(null);
    setCancelReason('');
    setCancelResult(null);
    setCancelSubmitting(false);
  };

  const handleCancelOrder = async () => {
    if (!cancelReason.trim()) return;
    setCancelSubmitting(true);
    setCancelResult(null);
    try {
      const items = cancelOrder.lineItems
        ? Object.values(cancelOrder.lineItems).map(i => ({ name: stripNotesSuffix(i.name), quantity: i.quantity }))
        : [];
      const res = await fetch('/api/cancel-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: cancelOrder.userId,
          orderId: cancelOrder.id,
          reason: cancelReason.trim(),
          sendEmail: cancelSendEmail,
          orderData: {
            senderEmail: cancelOrder.senderEmail,
            senderName: cancelOrder.senderName,
            recipientName: cancelOrder.recipient?.name,
            recipientPhone: formatRecipientPhone(cancelOrder.recipient),
            restaurantName: cancelOrder.restaurantName,
            date: formatDate(cancelOrder.createdAt),
            items,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCancelResult({ success: true, message: `Order cancelled${data.emailSent ? ' and email sent' : ''}` });
        setOrders(prev => prev.map(o =>
          o.id === cancelOrder.id ? { ...o, status: 'cancelled', cancellationReason: cancelReason.trim() } : o
        ));
        if (selectedOrder?.id === cancelOrder.id) {
          setSelectedOrder(prev => ({ ...prev, status: 'cancelled', cancellationReason: cancelReason.trim() }));
        }
        setTimeout(closeCancelModal, 2000);
      } else {
        setCancelResult({ success: false, message: data.error || 'Failed to cancel order' });
      }
    } catch (err) {
      setCancelResult({ success: false, message: err.message });
    } finally {
      setCancelSubmitting(false);
    }
  };

  // Store credit handlers
  const openStoreCreditModal = (order, e) => {
    if (e) e.stopPropagation();
    setStoreCreditOrder(order);
    setStoreCreditAmount('');
    setStoreCreditReason('');
    setStoreCreditResult(null);
    setStoreCreditSubmitting(false);
    setShowStoreCreditModal(true);
  };

  const closeStoreCreditModal = () => {
    setShowStoreCreditModal(false);
    setStoreCreditOrder(null);
    setStoreCreditAmount('');
    setStoreCreditReason('');
    setStoreCreditResult(null);
    setStoreCreditSubmitting(false);
  };

  const handleIssueStoreCredit = async () => {
    if (!storeCreditReason.trim() || !storeCreditAmount || parseFloat(storeCreditAmount) <= 0) return;
    setStoreCreditSubmitting(true);
    setStoreCreditResult(null);
    try {
      const res = await fetch('/api/store-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: storeCreditOrder.userId,
          customerEmail: storeCreditOrder.senderEmail,
          amountUSD: parseFloat(storeCreditAmount),
          reason: storeCreditReason.trim(),
          sourceOrderId: storeCreditOrder.id,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStoreCreditResult({ success: true, message: `Store credit issued: ${data.code}`, code: data.code });
        setOrders(prev => prev.map(o =>
          o.id === storeCreditOrder.id
            ? { ...o, storeCreditIssued: true, storeCreditCode: data.code, storeCreditAmount: Math.round(parseFloat(storeCreditAmount) * 100), storeCreditReason: storeCreditReason.trim() }
            : o
        ));
        if (selectedOrder?.id === storeCreditOrder.id) {
          setSelectedOrder(prev => ({
            ...prev,
            storeCreditIssued: true,
            storeCreditCode: data.code,
            storeCreditAmount: Math.round(parseFloat(storeCreditAmount) * 100),
            storeCreditReason: storeCreditReason.trim(),
          }));
        }
      } else {
        setStoreCreditResult({ success: false, message: data.error || 'Failed to issue store credit' });
      }
    } catch (err) {
      setStoreCreditResult({ success: false, message: err.message });
    } finally {
      setStoreCreditSubmitting(false);
    }
  };

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin - Orders</title>
      </Head>

      <PageHeader
        icon={Receipt}
        title="Order Management"
        subtitle={`${totalOrders} orders · page ${currentPage} of ${totalPages}`}
      />

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-5 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder={isMobile ? 'Search orders…' : 'Search by order ID, email, recipient, restaurant, or payment intent (pi_)…'}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[13px] text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 md:w-[420px] md:flex-none"
        />
        <button
          type="submit"
          className="inline-flex h-9 items-center rounded-[6px] bg-ink-900 px-4 text-[13px] font-medium text-white transition-colors hover:bg-ink-800"
        >
          Search
        </button>
        {search ? (
          <button
            type="button"
            onClick={() => { setSearchInput(''); setSearch(''); }}
            className="inline-flex h-9 items-center rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[13px] font-medium text-ink-700 transition-colors hover:bg-ink-50"
          >
            Clear
          </button>
        ) : null}
        {!isMobile ? (
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading || loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[13px] font-medium text-ink-700 transition-colors hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <DownloadSimple className="h-[14px] w-[14px]" weight="regular" />
            {downloading ? 'Downloading…' : 'Export CSV'}
          </button>
        ) : null}
      </form>

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3">
        {/* Status filter — trackwork segmented pill group */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-ink-500">Status:</span>
          <div className="inline-flex items-center gap-px rounded-[6px] border border-ink-100 bg-ink-50 p-0.5">
            {[
              { value: 'all', label: 'All' },
              { value: 'pending', label: 'Pending' },
              { value: 'dispatched', label: 'Dispatched' },
              { value: 'cancelled', label: 'Cancelled' },
            ].map(({ value, label }) => {
              const active = statusFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setStatusFilter(value); setCurrentPage(1); }}
                  className={
                    'rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors ' +
                    (active
                      ? 'bg-ink-0 text-ink-900 shadow-[0_1px_2px_rgba(11,14,20,0.06)]'
                      : 'text-ink-500 hover:text-ink-900')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time range */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-ink-500">Time range:</span>
          <div className="inline-flex items-center gap-px rounded-[6px] border border-ink-100 bg-ink-50 p-0.5">
            {ORDER_RANGES.map((label) => {
              const active = timeRange === label;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => {
                    setTimeRange(label);
                    if (!isCustomRangeLabel(label)) {
                      setCustomStartDate('');
                      setCustomEndDate('');
                    }
                    setCurrentPage(1);
                  }}
                  className={
                    'rounded-[4px] px-2.5 py-1 text-[12px] font-medium transition-colors ' +
                    (active
                      ? 'bg-ink-0 text-ink-900 shadow-[0_1px_2px_rgba(11,14,20,0.06)]'
                      : 'text-ink-500 hover:text-ink-900')
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
          {isCustomRange ? (
            <div className="flex items-center gap-2 rounded-[6px] border border-ink-200 bg-ink-0 px-2.5 py-1">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => { setCustomStartDate(e.target.value); setCurrentPage(1); }}
                className="bg-transparent text-[12px] text-ink-900 focus:outline-none"
              />
              <span className="text-[12px] text-ink-400">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => { setCustomEndDate(e.target.value); setCurrentPage(1); }}
                className="bg-transparent text-[12px] text-ink-900 focus:outline-none"
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Loading / Error states */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader />
        </div>
      ) : null}

      {error ? (
        <Banner variant="danger" className="mb-6">
          <div className="font-mono text-[12px] whitespace-pre-wrap">
            {error}
          </div>
          {error.includes('Firestore index') ? (
            <div className="mt-4 rounded-[6px] border border-ink-100 bg-ink-0 p-4 text-[13px] text-ink-700">
              <strong>How to fix this:</strong>
              <ol className="mt-2 list-decimal pl-5">
                <li>Go to <a href="https://console.firebase.google.com" target="_blank" rel="noopener noreferrer" className="text-accent underline">Firebase Console</a></li>
                <li>Select project: <strong>foodtoindia-dev</strong></li>
                <li>Navigate to: <strong>Firestore Database → Indexes</strong></li>
                <li>Create a composite index with:
                  <ul className="list-disc pl-5">
                    <li>Query scope: <strong>Collection group</strong></li>
                    <li>Collection group ID: <strong>orders</strong></li>
                    <li>Field: <strong>createdAt</strong> (Descending)</li>
                  </ul>
                </li>
                <li>Wait 2-5 minutes for index to build, then refresh this page</li>
              </ol>
            </div>
          ) : null}
        </Banner>
      ) : null}

      {/* Empty state */}
      {!loading && !error && orders.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px] text-ink-500">No orders found</p>
        </div>
      ) : null}

      {/* Orders Table — desktop */}
      {!loading && !error && orders.length > 0 && !isMobile ? (
        <TableShell>
          <thead>
            <tr>
              <Th>Order ID</Th>
              <Th>Date</Th>
              <Th>Sender</Th>
              <Th>Recipient</Th>
              <Th>City</Th>
              <Th>Restaurant</Th>
              <Th align="right">Items</Th>
              <Th align="right">Amount</Th>
              <Th>Payment</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const status = order.status || 'pending';
              const statusTone = status === 'dispatched' ? 'success'
                : status === 'cancelled' ? 'danger'
                : 'warn';
              return (
                <Tr key={order.id}>
                  <Td>
                    <button
                      type="button"
                      onClick={() => openOrderDetails(order)}
                      className="font-mono text-[13px] font-medium text-accent hover:underline"
                    >
                      {order.id.slice(0, 8)}
                    </button>
                  </Td>
                  <Td className="text-ink-600">{formatDate(order.createdAt)}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => handleSenderClick(order.senderEmail, order.senderName)}
                      className="text-[13px] font-medium text-accent hover:underline"
                    >
                      {order.senderName || 'N/A'}
                    </button>
                    <div className="text-[12px] text-ink-500">{order.senderEmail}</div>
                  </Td>
                  <Td>
                    <div className="text-ink-900">{order.recipient?.name || <Dash />}</div>
                    <div className="text-[12px] text-ink-500">
                      {formatRecipientPhone(order.recipient)}
                    </div>
                  </Td>
                  <Td>
                    {getRecipientCity(order) ? (
                      <Pill tone="accent">{getRecipientCity(order)}</Pill>
                    ) : <Dash />}
                  </Td>
                  <Td className="text-ink-700">{order.restaurantName || <Dash />}</Td>
                  <Td align="right" className="font-num">{Object.keys(order.lineItems || {}).length}</Td>
                  <Td align="right" className="font-num font-medium">{formatAmountPaid(order)}</Td>
                  <Td>
                    {(order.paymentProvider === 'store_credit' || order.paymentMethod === 'Store Credit') ? (
                      <Pill tone="success">Store Credit</Pill>
                    ) : order.paymentMethod ? (
                      <span className="text-[12px] text-ink-600">{order.paymentMethod}</span>
                    ) : (
                      <Dash />
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <Pill tone={statusTone}>{status}</Pill>
                      {renderContactPill(order.recipientContact)}
                    </div>
                  </Td>
                  <Td align="right">
                    <div className="inline-flex items-center gap-1">
                      {getWaPhone(order.recipient) && status !== 'cancelled' ? (
                        <IconButton
                          title={waButtonTooltip(order)}
                          onClick={(e) => handleSendWhatsApp(order, e)}
                        >
                          <WhatsappLogo className={`h-4 w-4 ${waIconColor(order)}`} weight="regular" />
                        </IconButton>
                      ) : null}
                      {order.senderEmail ? (
                        <IconButton
                          title={`Email ${order.senderName || order.senderEmail}`}
                          onClick={(e) => openEmailModal(order, e)}
                        >
                          <EnvelopeSimple className="h-4 w-4 text-ink-500" weight="regular" />
                        </IconButton>
                      ) : null}
                      {status !== 'cancelled' ? (
                        <IconButton
                          title="Cancel order"
                          onClick={(e) => openCancelModal(order, e)}
                        >
                          <XCircle className="h-4 w-4 text-danger" weight="regular" />
                        </IconButton>
                      ) : null}
                      <IconButton
                        title="Issue store credit"
                        onClick={(e) => openStoreCreditModal(order, e)}
                      >
                        <PlusCircle className="h-4 w-4 text-success" weight="regular" />
                      </IconButton>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      ) : null}

      {/* Mobile Order Cards */}
      {!loading && !error && orders.length > 0 && isMobile ? (
        <div className="flex flex-col gap-2">
          {orders.map((order) => {
            const status = order.status || 'pending';
            const statusTone = status === 'dispatched' ? 'success'
              : status === 'cancelled' ? 'danger'
              : 'warn';
            return (
              <div
                key={order.id}
                className="rounded-[8px] border border-ink-100 bg-ink-0 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openOrderDetails(order)}
                      className="font-mono text-[13px] font-medium text-accent"
                    >
                      {order.id.slice(0, 8)}
                    </button>
                    <span className="text-[11px] text-ink-400">
                      {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Pill tone={statusTone}>{status}</Pill>
                    {renderContactPill(order.recipientContact)}
                    {getWaPhone(order.recipient) && status !== 'cancelled' ? (
                      <IconButton onClick={(e) => handleSendWhatsApp(order, e)} title={waButtonTooltip(order)}>
                        <WhatsappLogo className={`h-3.5 w-3.5 ${waIconColor(order)}`} weight="regular" />
                      </IconButton>
                    ) : null}
                    {order.senderEmail ? (
                      <IconButton onClick={(e) => openEmailModal(order, e)}>
                        <EnvelopeSimple className="h-3.5 w-3.5 text-ink-500" weight="regular" />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
                <div className="mb-1 text-[13px] text-ink-900">
                  <button
                    type="button"
                    onClick={() => handleSenderClick(order.senderEmail, order.senderName)}
                    className="font-medium text-accent"
                  >
                    {order.senderName || 'N/A'}
                  </button>
                  <span className="text-ink-400"> → </span>
                  <span className="font-medium">{order.recipient?.name || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between text-[12px] text-ink-500">
                  <span>{order.restaurantName || <Dash />}</span>
                  <span className="font-num font-medium text-ink-900">
                    {formatAmountPaid(order)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Pagination - Bottom */}
      {!loading && !error && totalPages > 1 && renderPagination()}

      {/* Order Details Modal */}
      <Modal
        open={!!(showModal && selectedOrder)}
        onClose={closeModal}
        maxWidth="max-w-[1100px]"
      >
        {selectedOrder ? (
          <>
            {/* Order Header — info row + action row.
                Mobile: stacks naturally; actions wrap to a second line.
                Desktop: info left, actions right of the meta line. */}
            <div className="mb-5 flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <h2 className="m-0 text-[18px] font-semibold text-ink-900">Order Details</h2>
                <span className="font-mono text-[12px] text-ink-500">
                  {selectedOrder.id.slice(0, 12)}…
                </span>
                <span className="text-[12px] text-ink-500">
                  {formatDate(selectedOrder.createdAt)}
                </span>
                <Pill
                  tone={
                    selectedOrder.status === 'dispatched' ? 'success'
                    : selectedOrder.status === 'cancelled' ? 'danger'
                    : 'warn'
                  }
                >
                  {selectedOrder.status || 'pending'}
                </Pill>
                {(() => {
                  const di = deliveryInfo(selectedOrder);
                  return (
                    <span className="text-[12px] font-medium text-ink-700">
                      {di.type === 'Scheduled' ? `Scheduled · ${di.time}` : 'ASAP (now)'}
                    </span>
                  );
                })()}
              </div>
              {/* Action row — bordered "support tool" buttons with icons.
                  Each variant carries its own intent through color +
                  border weight (Airbnb / Apple support pattern).
                  Mobile shows ONLY the two ops actions (Update delivery
                  time, Update address). Store credit and cancel are
                  desktop-only — managed personally by the founder. */}
              <div className="flex flex-wrap gap-2">
                {(selectedOrder.status || 'pending') !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => setConfirmOrder(selectedOrder)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] bg-success px-3 py-1.5 text-[13px] font-medium text-ink-0 shadow-sm transition-colors hover:bg-success-strong"
                  >
                    <Clock className="h-4 w-4" weight="bold" />
                    Confirm delivery details
                  </button>
                )}
                {!isMobile && (
                  <button
                    type="button"
                    onClick={() => openStoreCreditModal(selectedOrder)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-ink-200 bg-ink-0 px-3 py-1.5 text-[13px] font-medium text-ink-900 transition-colors hover:border-ink-300 hover:bg-ink-50"
                  >
                    <Gift className="h-4 w-4 text-ink-600" weight="regular" />
                    Issue store credit
                  </button>
                )}
                {!isMobile && (selectedOrder.status || 'pending') !== 'cancelled' && (
                  <button
                    type="button"
                    onClick={() => openCancelModal(selectedOrder)}
                    className="ml-auto inline-flex items-center gap-1.5 rounded-[8px] border border-danger bg-ink-0 px-3 py-1.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger-weak"
                  >
                    <XCircle className="h-4 w-4" weight="regular" />
                    Cancel order
                  </button>
                )}
              </div>
            </div>

            {/* Cancellation reason banner */}
            {selectedOrder.cancellationReason && (
              <div className="mb-4 rounded-[8px] bg-danger-weak px-3.5 py-2.5 text-[13px] text-danger">
                <strong className="font-semibold">Cancellation reason:</strong> {selectedOrder.cancellationReason}
                {selectedOrder.cancelledBy && (
                  <span className="ml-2 text-[12px] text-ink-500">by {selectedOrder.cancelledBy}</span>
                )}
              </div>
            )}

            {/* Store credit log */}
            {selectedOrder.storeCreditIssued && (
              <div className="mb-4 rounded-[8px] bg-success-weak px-3.5 py-2.5 text-[13px] text-success">
                <strong className="font-semibold">Store credit issued:</strong> Code{' '}
                <strong className="font-semibold">{selectedOrder.storeCreditCode}</strong>
                {' · $'}{(selectedOrder.storeCreditAmount / 100).toFixed(2)}
                {selectedOrder.storeCreditReason && (
                  <span className="ml-1">({selectedOrder.storeCreditReason})</span>
                )}
                {selectedOrder.storeCreditIssuedBy && (
                  <span className="ml-2 text-[12px] text-ink-500">by {selectedOrder.storeCreditIssuedBy}</span>
                )}
              </div>
            )}

            {/* Sender · Recipient · Restaurant */}
            <div className={`grid gap-x-5 gap-y-4 border-b border-ink-100 pb-5 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-micro text-ink-500">Sender</div>
                <div className="text-[13.5px] font-medium text-ink-900">{cleanSenderName(selectedOrder.senderName)}</div>
                {selectedOrder.senderEmail && (
                  <div className="text-[12.5px] text-ink-600">{selectedOrder.senderEmail}</div>
                )}
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-micro text-ink-500">Recipient</div>
                <div className="text-[13.5px] font-medium text-ink-900">{selectedOrder.recipient?.name || 'N/A'}</div>
                {formatRecipientPhone(selectedOrder.recipient) && (
                  <div className="font-mono text-[12.5px] text-ink-600">{formatRecipientPhone(selectedOrder.recipient)}</div>
                )}
                {/* Full address from formatCurrentAddress (lib/orderDelivery).
                    Lines: door+street, landmark, area (from addressComponents
                    or de-corrupted formattedAddress). BugK fix lives in the
                    helper so both this surface and the dispatch view get
                    clean output - no more landmark-x3 from re-enrichment. */}
                {(() => {
                  // Traveler orders render the grouped venue block (venue label,
                  // name, full address, room, landmark) - byte-identical to the
                  // Slack [NEW ORDER] block. Non-traveler orders keep the
                  // existing format. Ops-confirmed traveler addresses fall back
                  // to the confirmed text inside formatTravelerDeliveryLines.
                  const { lines, source } = isTravelerOrder(selectedOrder)
                    ? formatTravelerDeliveryLines(selectedOrder)
                    : formatCurrentAddress(selectedOrder);
                  if (!lines.length) {
                    return getRecipientCity(selectedOrder) ? (
                      <div className="text-[12.5px] text-ink-600">{getRecipientCity(selectedOrder)}</div>
                    ) : null;
                  }
                  return (
                    <>
                      <div className="mt-1 whitespace-pre-line text-[12.5px] text-ink-600">
                        {lines.join('\n')}
                      </div>
                      {source !== 'sender_entered' ? (
                        <div className="mt-0.5 text-[10.5px] font-medium uppercase tracking-wider text-success">
                          {source === 'ops_updated' ? 'Updated by ops' : 'Confirmed by recipient'}
                        </div>
                      ) : null}
                    </>
                  );
                })()}
                {/* Rider handoff preference, right under the address - the
                    dispatcher relays it to the rider ("meet at the lobby /
                    entrance" etc.). Clean field on the order doc; nothing to
                    strip. */}
                {selectedOrder.deliveryHandoff?.label && (
                  <div className="mt-1 text-[12.5px] text-ink-700">
                    <span className="font-semibold">Handoff:</span> {selectedOrder.deliveryHandoff.label}
                    {selectedOrder.deliveryHandoff.note ? ` - ${selectedOrder.deliveryHandoff.note}` : ''}
                  </div>
                )}
                {/* D11 (revised): inline map preview instead of external link.
                    Click "Show map" expands a Google Maps iframe in place,
                    keeping ops inside admin instead of deep-linking to their
                    personal Google Maps app on mobile. Silent when the order
                    has no usable pin coords. */}
                <MapsPreview order={selectedOrder} />
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-micro text-ink-500">Restaurant</div>
                <div className="text-[13.5px] font-medium text-ink-900">{selectedOrder.restaurantName || 'N/A'}</div>
                {selectedOrder.restaurantCity && (
                  <div className="text-[12.5px] text-ink-600">{selectedOrder.restaurantCity}</div>
                )}
                {formatOrderDistance(selectedOrder) && (
                  <div className="text-[12.5px] text-ink-600">{formatOrderDistance(selectedOrder)}</div>
                )}
              </div>
            </div>

            {/* Items + payment — two columns on desktop, stacked on mobile */}
            <div className={`mt-5 grid items-start gap-6 ${isMobile ? 'grid-cols-1' : 'grid-cols-[1.5fr_1fr]'}`}>

            {/* Left column: items, note, summary */}
            <div>
              <div className="mb-2 text-[13px] font-semibold text-ink-900">Items Ordered</div>
              {selectedOrder.lineItems && Object.keys(selectedOrder.lineItems).length > 0 ? (
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Item</Th>
                      <Th align="right">Qty</Th>
                      <Th align="right">Price</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(selectedOrder.lineItems).map(([itemId, item]) => (
                      <Tr key={itemId}>
                        <Td className="whitespace-normal">
                          {stripNotesSuffix(item.name) || 'Unknown Item'}
                          {Array.isArray(item.variants) && item.variants.length > 0 && (
                            <div className="text-[12px] text-ink-500">
                              {item.variants.map(v => v?.name).filter(Boolean).join(', ')}
                            </div>
                          )}
                        </Td>
                        <Td align="right" className="font-num tnum text-ink-600">{item.quantity || 1}</Td>
                        <Td align="right" className="font-num tnum">{formatCurrency(item.price || 0, selectedOrder)}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableShell>
              ) : (
                <p className="text-[13px] text-ink-500">No items found</p>
              )}

              {/* Note to restaurant (sender's special instructions) */}
              {selectedOrder.notes && (
                <div className="mt-3.5 whitespace-pre-wrap rounded-[8px] border border-warn/30 bg-warn-weak px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-700">
                  <strong className="font-semibold text-success">Note to restaurant, from sender:</strong> {selectedOrder.notes}
                </div>
              )}

              {/* Order summary */}
              <div className="mt-3.5 rounded-[8px] border border-ink-100 bg-ink-50 px-3.5 py-3">
                {(selectedOrder.subTotal || (selectedOrder.lineItems && Object.keys(selectedOrder.lineItems).length > 0)) && (
                  <div className="flex justify-between py-0.5 text-[13px]">
                    <span className="text-ink-600">Subtotal</span>
                    <span className="font-num tnum text-ink-900">
                      {formatCurrency(
                        selectedOrder.subTotal ||
                        Object.values(selectedOrder.lineItems || {}).reduce((sum, item) => sum + (item.price || 0), 0),
                        selectedOrder
                      )}
                    </span>
                  </div>
                )}
                {(selectedOrder.deliveryFee || selectedOrder.deliveryAmount) && (
                  <div className="flex justify-between py-0.5 text-[13px]">
                    <span className="text-ink-600">Delivery Fee</span>
                    <span className="font-num tnum text-ink-900">{formatCurrency(selectedOrder.deliveryFee || selectedOrder.deliveryAmount, selectedOrder)}</span>
                  </div>
                )}
                {(selectedOrder.serviceFee || selectedOrder.platformFee) && (
                  <div className="flex justify-between py-0.5 text-[13px]">
                    <span className="text-ink-600">Service Fee</span>
                    <span className="font-num tnum text-ink-900">{formatCurrency(selectedOrder.serviceFee || selectedOrder.platformFee, selectedOrder)}</span>
                  </div>
                )}
                {(selectedOrder.tax || selectedOrder.taxAmount || selectedOrder.taxes) && (
                  <div className="flex justify-between py-0.5 text-[13px]">
                    <span className="text-ink-600">Tax</span>
                    <span className="font-num tnum text-ink-900">{formatCurrency(selectedOrder.tax || selectedOrder.taxAmount || selectedOrder.taxes, selectedOrder)}</span>
                  </div>
                )}
                {(selectedOrder.tip || selectedOrder.tipAmount) && (
                  <div className="flex justify-between py-0.5 text-[13px]">
                    <span className="text-ink-600">Tip</span>
                    <span className="font-num tnum text-ink-900">{formatCurrency(selectedOrder.tip || selectedOrder.tipAmount, selectedOrder)}</span>
                  </div>
                )}
                {(selectedOrder.discount || selectedOrder.promoDiscount || selectedOrder.discountAmount) && (
                  <div className="flex justify-between py-0.5 text-[13px] text-success">
                    <span>Discount</span>
                    <span className="font-num tnum">-{formatCurrency(selectedOrder.discount || selectedOrder.promoDiscount || selectedOrder.discountAmount, selectedOrder)}</span>
                  </div>
                )}
                {/* Referral credit — stored in USD dollars, not INR paise,
                    so it is NOT passed through formatCurrency. */}
                {selectedOrder.referralCreditsApplied?.amountUSD ? (
                  <div className="flex justify-between py-0.5 text-[13px] text-success">
                    <span>Referral credit</span>
                    <span className="font-num tnum">-${Number(selectedOrder.referralCreditsApplied.amountUSD).toFixed(2)}</span>
                  </div>
                ) : null}
                <div className="mt-1.5 flex justify-between border-t border-ink-200 pt-2">
                  <strong className="text-[14px] font-semibold text-ink-900">Total Amount</strong>
                  <strong className="font-num tnum text-[15px] font-semibold text-accent">{formatCurrency(selectedOrder.totalAmount, selectedOrder)}</strong>
                </div>
              </div>
            </div>

            {/* Right column: payment */}
            <div>
              <div className="mb-2 text-[13px] font-semibold text-ink-900">Payment Details</div>
              {(() => {
                const charge = selectedOrder.paymentIntent?.charges?.data?.[0];
                const cardDetails = charge?.payment_method_details?.card;
                const wallet = cardDetails?.wallet;

                if (!charge && !selectedOrder.paymentIntent) return null;

                return (
                  <div className="rounded-[8px] border border-ink-100 bg-ink-50 px-3.5 py-3">
                    {cardDetails && (
                      <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                        <span className="shrink-0 text-ink-600">Card</span>
                        <span className="text-right text-ink-900">
                          {cardDetails.brand?.charAt(0).toUpperCase() + cardDetails.brand?.slice(1)} ····{cardDetails.last4}
                          {cardDetails.exp_month && cardDetails.exp_year && (
                            <span className="text-ink-500"> (exp {cardDetails.exp_month}/{cardDetails.exp_year.toString().slice(-2)})</span>
                          )}
                          {cardDetails.country && (
                            <span className="ml-1.5 rounded-[4px] bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-600">{cardDetails.country}</span>
                          )}
                        </span>
                      </div>
                    )}
                    {wallet && (
                      <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                        <span className="text-ink-600">Wallet</span>
                        <span className="rounded-[5px] bg-ink-900 px-2 py-0.5 text-[11px] font-medium text-ink-0">
                          {wallet.type === 'apple_pay' ? 'Apple Pay'
                            : wallet.type === 'google_pay' ? 'Google Pay'
                            : wallet.type === 'link' ? 'Stripe Link'
                            : wallet.type}
                        </span>
                      </div>
                    )}
                    {charge?.status && (
                      <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                        <span className="text-ink-600">Status</span>
                        <Pill tone={charge.status === 'succeeded' ? 'success' : charge.status === 'failed' ? 'danger' : 'warn'}>
                          {charge.status}
                        </Pill>
                      </div>
                    )}
                    {charge?.disputed && (
                      <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                        <span className="text-ink-600">Dispute</span>
                        <Pill tone="danger">Disputed</Pill>
                      </div>
                    )}
                    {charge?.refunded && (
                      <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                        <span className="text-ink-600">Refunded</span>
                        <span className="text-danger">
                          ${(charge.amount_refunded / 100).toFixed(2)}
                          {charge.amount_refunded === charge.amount ? ' (Full)' : ' (Partial)'}
                        </span>
                      </div>
                    )}
                    {selectedOrder.paymentIntent?.id && (
                      <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                        <span className="shrink-0 text-ink-600">Payment Intent</span>
                        <span className="break-all text-right font-mono text-[11.5px] text-ink-600">{selectedOrder.paymentIntent.id}</span>
                      </div>
                    )}
                    {charge?.outcome?.risk_score !== undefined && (
                      <div className="flex items-center justify-between gap-3 py-1 text-[13px]">
                        <span className="text-ink-600">Risk Score</span>
                        <span className={`font-medium ${charge.outcome.risk_score > 65 ? 'text-danger' : charge.outcome.risk_score > 30 ? 'text-warn' : 'text-success'}`}>
                          {charge.outcome.risk_score}/100 ({charge.outcome.risk_level})
                        </span>
                      </div>
                    )}
                    {selectedOrder.paymentIntent?.id && (
                      <div className="mt-2 border-t border-ink-200 pt-2">
                        <a
                          href={`https://dashboard.stripe.com/payments/${selectedOrder.paymentIntent.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[12.5px] font-medium text-accent hover:underline"
                        >
                          View in Stripe →
                        </a>
                        <div className="mt-1 text-[11.5px] italic text-ink-500">
                          Payment data is a snapshot; check Stripe for disputes or refunds.
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            </div>  {/* Close items + payment grid */}

            {/* Internal notes + audit trail (ops-only) */}
            <InternalNotes key={selectedOrder.id} userId={selectedOrder.userId} orderId={selectedOrder.id} />
          </>
        ) : null}
      </Modal>

      {/* Email Sender Modal */}
      <Modal
        open={!!(showEmailModal && emailOrder)}
        onClose={closeEmailModal}
        title="Email sender"
        maxWidth="max-w-[720px]"
      >
        {emailOrder ? (
          <>

            {/* From */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#444b57', marginBottom: '4px' }}>From</label>
              <select
                value={emailFrom}
                onChange={(e) => setEmailFrom(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '14px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: 'white',
                }}
              >
                <option value="support@foodtoindia.com">support@foodtoindia.com</option>
                <option value="orders@foodtoindia.com">orders@foodtoindia.com</option>
                <option value="santhosh@foodtoindia.com">santhosh@foodtoindia.com</option>
              </select>
            </div>

            {/* To */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#444b57', marginBottom: '4px' }}>To</label>
              <input
                type="text"
                value={emailOrder.senderEmail}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '14px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f5f5f5',
                  color: '#0b0e14',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Subject */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#444b57', marginBottom: '4px' }}>Subject</label>
              <input
                type="text"
                value={`Regarding: Order to ${emailOrder.recipient?.name || 'Recipient'}`}
                disabled
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  fontSize: '14px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  backgroundColor: '#f5f5f5',
                  color: '#0b0e14',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Body */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#444b57', marginBottom: '4px' }}>Message</label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={8}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '14px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  resize: 'vertical',
                  fontFamily: 'Arial, sans-serif',
                  lineHeight: '1.5',
                  boxSizing: 'border-box',
                }}
                placeholder="Type your message here..."
              />
            </div>

            {/* Order Reference Preview */}
            <div style={{
              padding: '12px 15px',
              backgroundColor: '#faf8f5',
              borderRadius: '6px',
              border: '1px solid #EDE8E1',
              marginBottom: '15px',
            }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#8A8279', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
                Order Reference (included in email)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '4px 10px', fontSize: '13px' }}>
                <span style={{ color: '#8A8279' }}>Order ID:</span>
                <span style={{ color: '#0b0e14', fontWeight: '500' }}>{emailOrder.id}</span>
                <span style={{ color: '#8A8279' }}>Date:</span>
                <span style={{ color: '#0b0e14' }}>{formatDate(emailOrder.createdAt)}</span>
                <span style={{ color: '#8A8279' }}>Recipient:</span>
                <span style={{ color: '#0b0e14' }}>{emailOrder.recipient?.name || 'N/A'}</span>
                <span style={{ color: '#8A8279' }}>Phone:</span>
                <span style={{ color: '#0b0e14' }}>{formatRecipientPhone(emailOrder.recipient) || 'N/A'}</span>
                <span style={{ color: '#8A8279' }}>Restaurant:</span>
                <span style={{ color: '#0b0e14' }}>{emailOrder.restaurantName || 'N/A'}</span>
              </div>
              {emailOrder.lineItems && Object.keys(emailOrder.lineItems).length > 0 && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #EDE8E1' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#8A8279', marginBottom: '4px' }}>Items</div>
                  {Object.values(emailOrder.lineItems).map((item, i) => (
                    <div key={i} style={{ fontSize: '13px', color: '#0b0e14', padding: '2px 0' }}>
                      {item.name || 'Unknown'}{item.quantity > 1 ? ` × ${item.quantity}` : ''}
                      {Array.isArray(item.variants) && item.variants.length > 0 && (
                        <div style={{ fontSize: '12px', color: '#8A8279' }}>
                          {item.variants.map(v => v?.name).filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Result message */}
            {emailResult && (
              <div style={{
                padding: '10px 15px',
                marginBottom: '15px',
                borderRadius: '4px',
                backgroundColor: emailResult.success ? '#e6f4ec' : '#fbe8e6',
                color: emailResult.success ? '#0f7a52' : '#b42318',
                fontSize: '14px',
              }}>
                {emailResult.message}
              </div>
            )}

            {/* Send Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={closeEmailModal}
                style={{
                  padding: '10px 20px',
                  fontSize: '14px',
                  backgroundColor: '#f7f8f9',
                  color: '#0b0e14',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSendOrderEmail}
                disabled={emailSending || !emailBody.trim()}
                style={{
                  padding: '10px 24px',
                  fontSize: '14px',
                  backgroundColor: emailSending ? '#636a78' : '#117150',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: emailSending || !emailBody.trim() ? 'not-allowed' : 'pointer',
                  fontWeight: '500',
                }}
              >
                {emailSending ? 'Sending...' : 'Send Email'}
              </button>
            </div>
          </>
        ) : null}
      </Modal>

      {/* Sender Orders Modal */}
      <Modal
        open={!!(showSenderModal && selectedSender)}
        onClose={closeSenderModal}
        title={selectedSender ? `Orders by ${selectedSender.name}` : ''}
        subtitle={selectedSender?.email}
        maxWidth="max-w-[1200px]"
      >
        {selectedSender ? (
          <>

            {/* Loading or Summary Stats */}
            {senderOrdersLoading ? (
              <div style={{
                padding: '40px',
                textAlign: 'center',
                backgroundColor: '#f7f8f9',
                borderRadius: '4px',
                marginBottom: '20px'
              }}>
                <p style={{ fontSize: '16px', color: '#636a78', margin: 0 }}>Loading orders...</p>
              </div>
            ) : (
              <>
                {/* Summary Stats */}
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '20px',
                  marginBottom: '20px',
                  padding: '15px',
                  backgroundColor: '#f7f8f9',
                  borderRadius: '4px'
                }}>
                  <div>
                    <strong>Total Orders:</strong> {senderOrders.length}
                  </div>
                  <div>
                    <strong>Total Spent:</strong>{' '}
                    {`$${senderOrders
                      .reduce((sum, order) => sum + orderUsd(order), 0)
                      .toFixed(2)}`}
                  </div>
                  {senderOrders.length > 0 && (() => {
                    // Calculate first order, last order, and frequency
                    const sortedOrders = [...senderOrders].sort((a, b) => {
                      const dateA = new Date(a.createdAt || 0);
                      const dateB = new Date(b.createdAt || 0);
                      return dateA - dateB;
                    });
                    const firstOrder = sortedOrders[0];
                    const lastOrder = sortedOrders[sortedOrders.length - 1];

                    const firstDate = new Date(firstOrder.createdAt);
                    const lastDate = new Date(lastOrder.createdAt);

                    // Format dates as "Jan 12, 2025"
                    const formatAnalyticsDate = (date) => {
                      return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      });
                    };

                    // Calculate frequency if more than one order
                    let frequency = null;
                    if (senderOrders.length > 1) {
                      const daysDiff = (lastDate - firstDate) / (1000 * 60 * 60 * 24);
                      const monthsDiff = daysDiff / 30.44; // Average days per month

                      if (monthsDiff > 0) {
                        const ordersPerMonth = senderOrders.length / monthsDiff;
                        frequency = `${ordersPerMonth.toFixed(1)} orders/month`;
                      }
                    }

                    return (
                      <>
                        <div>
                          <strong>First Order:</strong> {formatAnalyticsDate(firstDate)}
                        </div>
                        <div>
                          <strong>Last Order:</strong> {formatAnalyticsDate(lastDate)}
                        </div>
                        {frequency && (
                          <div>
                            <strong>Frequency:</strong> {frequency}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </>
            )}

            {/* Download Button and Orders Table - only show when not loading */}
            {!senderOrdersLoading && (
              <>
                {/* Download Button */}
                <button
                  type="button"
                  onClick={handleDownloadSenderOrders}
                  className="mb-5 inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[13px] font-medium text-ink-700 transition-colors hover:bg-ink-50"
                >
                  <DownloadSimple className="h-[14px] w-[14px]" weight="regular" />
                  Download these orders
                </button>

                {/* Orders Table */}
                {(() => {
              const startIdx = (senderModalPage - 1) * 25;
              const endIdx = startIdx + 25;
              const paginatedOrders = senderOrders.slice(startIdx, endIdx);
              const totalModalPages = Math.ceil(senderOrders.length / 25);

              return (
                <>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      border: '1px solid #ddd',
                      backgroundColor: 'white',
                    }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f7f8f9' }}>
                          <th style={headerStyle}>Date</th>
                          <th style={headerStyle}>Recipient</th>
                          <th style={headerStyle}>City</th>
                          <th style={headerStyle}>Restaurant</th>
                          <th style={headerStyle}>Amount</th>
                          <th style={headerStyle}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedOrders.map((order) => (
                          <tr key={order.id} style={{ borderBottom: '1px solid #ddd' }}>
                            <td style={cellStyle}>{formatDate(order.createdAt)}</td>
                            <td style={cellStyle}>
                              <div>{order.recipient?.name || 'N/A'}</div>
                              <div style={{ fontSize: '12px', color: '#636a78' }}>{formatRecipientPhone(order.recipient)}</div>
                            </td>
                            <td style={cellStyle}>{getRecipientCity(order)}</td>
                            <td style={cellStyle}>{order.restaurantName || 'N/A'}</td>
                            <td style={cellStyle}>{formatAmountPaid(order)}</td>
                            <td style={cellStyle}>
                              <span style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                backgroundColor:
                                  order.status === 'dispatched' ? '#e6f4ec' :
                                  order.status === 'cancelled' ? '#fbe8e6' :
                                  '#fbf0dc',
                                color:
                                  order.status === 'dispatched' ? '#0f7a52' :
                                  order.status === 'cancelled' ? '#b42318' :
                                  '#a05a00',
                              }}>
                                {order.status || 'pending'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalModalPages > 1 && (
                    <div style={{
                      marginTop: '20px',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: '10px',
                    }}>
                      <button
                        onClick={() => setSenderModalPage(Math.max(1, senderModalPage - 1))}
                        disabled={senderModalPage === 1}
                        style={{
                          padding: '8px 12px',
                          fontSize: '14px',
                          backgroundColor: senderModalPage === 1 ? '#eef0f3' : '#3f3ccc',
                          color: senderModalPage === 1 ? '#636a78' : 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: senderModalPage === 1 ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Previous
                      </button>
                      <span>
                        Page {senderModalPage} of {totalModalPages}
                      </span>
                      <button
                        onClick={() => setSenderModalPage(Math.min(totalModalPages, senderModalPage + 1))}
                        disabled={senderModalPage === totalModalPages}
                        style={{
                          padding: '8px 12px',
                          fontSize: '14px',
                          backgroundColor: senderModalPage === totalModalPages ? '#eef0f3' : '#3f3ccc',
                          color: senderModalPage === totalModalPages ? '#636a78' : 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: senderModalPage === totalModalPages ? 'not-allowed' : 'pointer',
                        }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              );
            })()}
              </>
            )}
          </>
        ) : null}
      </Modal>

      {/* Cancel Order Modal */}
      <Modal
        open={!!(showCancelModal && cancelOrder)}
        onClose={closeCancelModal}
        title="Cancel / refund order"
        maxWidth="max-w-[520px]"
      >
        {cancelOrder ? (
          <>
            <div className="mb-4 rounded-[6px] bg-ink-50 px-3 py-2.5 text-[13px] text-ink-700">
              <div><span className="text-ink-500">Order:</span> <span className="font-mono">{cancelOrder.id.slice(0, 12)}…</span></div>
              <div><span className="text-ink-500">Date:</span> {formatDate(cancelOrder.createdAt)}</div>
              <div><span className="text-ink-500">Sender:</span> {cancelOrder.senderName || 'N/A'} ({cancelOrder.senderEmail})</div>
              <div><span className="text-ink-500">Amount:</span> <span className="font-num font-medium">{formatAmountPaid(cancelOrder)}</span></div>
            </div>

            <label className="mb-1 block text-[12px] font-medium text-ink-700">Reason for cancellation *</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g., Recipient out of town, customer requested cancellation…"
              rows={3}
              className="mb-4 w-full resize-y rounded-[6px] border border-ink-200 bg-ink-0 px-3 py-2 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />

            <label className="mb-4 flex cursor-pointer items-center gap-2 text-[13px] text-ink-700">
              <input
                type="checkbox"
                checked={cancelSendEmail}
                onChange={(e) => setCancelSendEmail(e.target.checked)}
                className="h-4 w-4 rounded border-ink-300 text-accent focus:ring-accent"
              />
              Send cancellation email to customer
            </label>

            {cancelResult ? (
              <div className={`mb-4 rounded-[6px] px-3 py-2 text-[13px] ${cancelResult.success ? 'bg-success-weak text-success' : 'bg-danger-weak text-danger'}`}>
                {cancelResult.message}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={closeCancelModal}>
                Close
              </Button>
              <button
                type="button"
                onClick={handleCancelOrder}
                disabled={cancelSubmitting || !cancelReason.trim()}
                className="rounded-[6px] bg-danger px-4 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-danger disabled:cursor-not-allowed disabled:bg-ink-300"
              >
                {cancelSubmitting ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
            </div>
          </>
        ) : null}
      </Modal>

      {/* Store Credit Modal */}
      <Modal
        open={!!(showStoreCreditModal && storeCreditOrder)}
        onClose={closeStoreCreditModal}
        title="Issue store credit"
        maxWidth="max-w-[520px]"
      >
        {storeCreditOrder ? (
          <>
            <div className="mb-4 rounded-[6px] bg-ink-50 px-3 py-2.5 text-[13px] text-ink-700">
              <div><span className="text-ink-500">Order:</span> <span className="font-mono">{storeCreditOrder.id.slice(0, 12)}…</span></div>
              <div><span className="text-ink-500">Customer:</span> {storeCreditOrder.senderName || 'N/A'} ({storeCreditOrder.senderEmail})</div>
              <div><span className="text-ink-500">Order amount:</span> <span className="font-num font-medium">{formatAmountPaid(storeCreditOrder)}</span></div>
            </div>

            <label className="mb-1 block text-[12px] font-medium text-ink-700">Credit amount (USD) *</label>
            <input
              type="number"
              value={storeCreditAmount}
              onChange={(e) => setStoreCreditAmount(e.target.value)}
              placeholder="25.00"
              min="0.01"
              step="0.01"
              className="mb-4 w-full rounded-[6px] border border-ink-200 bg-ink-0 px-3 py-2 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />

            <label className="mb-1 block text-[12px] font-medium text-ink-700">Reason for store credit *</label>
            <textarea
              value={storeCreditReason}
              onChange={(e) => setStoreCreditReason(e.target.value)}
              placeholder="e.g., Order delayed, wrong items delivered…"
              rows={3}
              className="mb-4 w-full resize-y rounded-[6px] border border-ink-200 bg-ink-0 px-3 py-2 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />

            <div className="mb-4 rounded-[6px] bg-success-weak px-3 py-2 text-[12px] text-success">
              A unique store credit code will be generated for this customer, valid for 1 year. It works like a promo code that only they can use.
            </div>

            {storeCreditResult ? (
              <div className={`mb-4 rounded-[6px] px-3 py-2 text-[13px] ${storeCreditResult.success ? 'bg-success-weak text-success' : 'bg-danger-weak text-danger'}`}>
                {storeCreditResult.success ? (
                  <div>
                    <div className="mb-1 font-medium">Store credit issued successfully!</div>
                    <div>Code: <strong className="font-mono text-[15px]">{storeCreditResult.code}</strong></div>
                  </div>
                ) : storeCreditResult.message}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={closeStoreCreditModal}>
                {storeCreditResult?.success ? 'Done' : 'Cancel'}
              </Button>
              {!storeCreditResult?.success ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleIssueStoreCredit}
                  disabled={storeCreditSubmitting || !storeCreditReason.trim() || !storeCreditAmount || parseFloat(storeCreditAmount) <= 0}
                >
                  {storeCreditSubmitting ? 'Issuing…' : 'Issue store credit'}
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </Modal>

      {/* Unified "Confirm delivery details" modal — shared component. */}
      <ConfirmDeliveryDetailsModal
        order={confirmOrder}
        open={!!confirmOrder}
        onClose={() => setConfirmOrder(null)}
        onSaved={handleConfirmSaved}
      />
    </AdminShell>
  );
}

const headerStyle = {
  padding: '12px 8px',
  textAlign: 'left',
  fontWeight: 'bold',
  fontSize: '14px',
  borderBottom: '2px solid #ddd',
};

const cellStyle = {
  padding: '12px 8px',
  fontSize: '14px',
};

export const getServerSideProps = withAuth();
