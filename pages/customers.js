import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { withAuth } from '../lib/withAuth';
import { Users } from '@phosphor-icons/react';
import { Banner } from '@cloudflare/kumo';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { Modal } from '../components/layout/Modal';

export default function CustomersPage() {
  const router = useRouter();
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
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [segment, setSegment] = useState('all');
  const [downloading, setDownloading] = useState(false);
  const [environment, setEnvironment] = useState('dev');
  const [showOrdersModal, setShowOrdersModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showUnsubscribedOnly, setShowUnsubscribedOnly] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });
  const [previewModal, setPreviewModal] = useState(null);

  useEffect(() => {
    fetchCustomers();
    fetchEnvironment();
  }, [search, segment, showUnsubscribedOnly]);

  const handleSort = (key) => {
    setSortConfig((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );
  };

  const sortedCustomers = useMemo(() => {
    if (!sortConfig.key) return customers;
    const accessor = SORT_ACCESSORS[sortConfig.key];
    if (!accessor) return customers;
    const sorted = [...customers].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      const aNull = av == null || (typeof av === 'number' && Number.isNaN(av));
      const bNull = bv == null || (typeof bv === 'number' && Number.isNaN(bv));
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      if (av < bv) return sortConfig.dir === 'asc' ? -1 : 1;
      if (av > bv) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [customers, sortConfig]);

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

  const fetchCustomers = async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        ...(search && { search }),
        ...(segment && { segment }),
        ...(forceRefresh && { forceRefresh: 'true' }),
        ...(showUnsubscribedOnly && { showUnsubscribedOnly: 'true' }),
      });
      const response = await fetch(`/api/customers?${params}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || errorData.error || 'Failed to fetch customers';
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setCustomers(data.customers || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchCustomers(true); // Force refresh
    } finally {
      setRefreshing(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  // totalSpent / avgOrderValue arrive from the API already in USD, converted
  // per order at each order's own rate (see lib/currency.js).
  const formatCurrency = (usd) => `$${Number(usd || 0).toFixed(2)}`;

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatAttribution = (attribution) => {
    if (!attribution || !attribution.source) return '—';
    const labels = {
      google: 'Google',
      ai_search: 'AI search',
      social_media: 'Social',
      friend: 'Friend',
      other: 'Other',
    };
    const label = labels[attribution.source] || attribution.source;
    return attribution.customText ? `${label} — "${attribution.customText}"` : label;
  };

  const getCustomerSegment = (customer) => {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const lastOrderDate = new Date(customer.lastOrderDate).getTime();

    if (customer.totalSpent >= 65 && customer.orderCount >= 3) {
      return { label: 'VIP', color: '#6f42c1', bgColor: '#e7d9f7' };
    }
    if (customer.orderCount >= 5) {
      return { label: 'Loyal', color: '#0056b3', bgColor: '#eceafb' };
    }
    if (customer.orderCount >= 2 && lastOrderDate < thirtyDaysAgo) {
      return { label: 'At Risk', color: '#b42318', bgColor: '#fbe8e6' };
    }
    if (customer.orderCount === 1) {
      return { label: 'One-time', color: '#a05a00', bgColor: '#fbf0dc' };
    }
    if (lastOrderDate >= thirtyDaysAgo) {
      return { label: 'Active', color: '#0f7a52', bgColor: '#e6f4ec' };
    }
    return { label: 'Inactive', color: '#636a78', bgColor: '#eef0f3' };
  };

  const handleCustomerClick = (customer) => {
    setSelectedCustomer(customer);
    setShowOrdersModal(true);
  };

  const closeOrdersModal = () => {
    setShowOrdersModal(false);
    setSelectedCustomer(null);
  };

  const convertToCSV = (data) => {
    if (!data || data.length === 0) return '';

    const headers = [
      'Name',
      'Email',
      'Number of Orders',
      'First Transaction',
      'Last Transaction',
      'Days Since Last Order',
      'Total Spent',
      'Average Order Value',
      'Source',
      'Segment',
      'Email Unsubscribed'
    ];

    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    };

    const rows = data.map(customer => {
      const seg = getCustomerSegment(customer);
      return [
        escapeCSV(customer.name),
        escapeCSV(customer.email),
        escapeCSV(customer.orderCount),
        escapeCSV(formatDate(customer.firstOrderDate)),
        escapeCSV(formatDate(customer.lastOrderDate)),
        escapeCSV(customer.daysSinceLastOrder || 'N/A'),
        escapeCSV(formatCurrency(customer.totalSpent)),
        escapeCSV(formatCurrency(customer.avgOrderValue)),
        escapeCSV(formatAttribution(customer.attribution)),
        escapeCSV(seg.label),
        escapeCSV(customer.emailUnsubscribed ? 'Yes' : 'No')
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

  const handleDownload = () => {
    if (customers.length === 0) {
      alert('No customers to download');
      return;
    }

    const csvContent = convertToCSV(customers);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = segment !== 'all'
      ? `customers_${segment}_${timestamp}.csv`
      : `customers_${timestamp}.csv`;

    downloadCSV(csvContent, filename);
    alert(`Successfully downloaded ${customers.length} customers`);
  };

  const openSendPreview = async (customer, campaignType) => {
    setPreviewModal({
      customer,
      campaignType,
      loading: true,
      sending: false,
      error: null,
      success: false,
      subject: '',
      html: '',
    });
    try {
      const url = `/api/customers/preview-engagement?email=${encodeURIComponent(customer.email)}&campaignType=${campaignType}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) {
        setPreviewModal((prev) =>
          prev ? { ...prev, loading: false, error: data.error || 'Failed to load preview' } : prev,
        );
        return;
      }
      setPreviewModal((prev) =>
        prev ? { ...prev, loading: false, subject: data.subject, html: data.html } : prev,
      );
    } catch (err) {
      console.error('preview-engagement failed', err);
      setPreviewModal((prev) =>
        prev ? { ...prev, loading: false, error: 'Network error loading preview' } : prev,
      );
    }
  };

  const confirmSend = async () => {
    if (!previewModal || previewModal.sending || previewModal.success) return;
    const { customer, campaignType } = previewModal;
    setPreviewModal((prev) => (prev ? { ...prev, sending: true, error: null } : prev));
    try {
      const res = await fetch('/api/customers/send-engagement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: customer.email, campaignType }),
      });
      const data = await res.json();
      if (!res.ok) {
        let msg = data.error || 'Failed to send email';
        if (data.code === 'COOLDOWN') {
          msg = `Already sent on ${formatShortDate(data.lastSentAt)} — ${COOLDOWN_DAYS}-day cooldown.`;
        } else if (data.code === 'UNSUBSCRIBED') {
          msg = 'This customer is unsubscribed and cannot receive emails.';
        }
        setPreviewModal((prev) => (prev ? { ...prev, sending: false, error: msg } : prev));
        return;
      }

      // Optimistically reflect the new send in local state so the row button
      // shows cooldown immediately, before the next /api/customers refetch.
      setCustomers((prev) =>
        prev.map((c) =>
          c.email === customer.email
            ? {
                ...c,
                engagementHistory: {
                  ...(c.engagementHistory || {}),
                  [campaignType]: {
                    ...(c.engagementHistory?.[campaignType] || {}),
                    sentAt: data.sentAt,
                    subject: data.subject,
                  },
                },
              }
            : c,
        ),
      );
      setPreviewModal((prev) => (prev ? { ...prev, sending: false, success: true } : prev));
    } catch (err) {
      console.error('send-engagement failed', err);
      setPreviewModal((prev) =>
        prev ? { ...prev, sending: false, error: 'Network error sending email' } : prev,
      );
    }
  };

  const closePreview = () => setPreviewModal(null);

  const handleAbandonedAction = (customer, actionType) => {
    if (actionType === 'remind-complete') {
      // User has recipients but hasn't completed an order
      const message = `Send reminder to ${customer.name} (${customer.email}) to complete their first order?\n\nThey have ${customer.recipientCount} recipient${customer.recipientCount !== 1 ? 's' : ''} added.`;
      if (confirm(message)) {
        // TODO: Implement email/notification API
        alert('Reminder functionality coming soon! This will send an email to encourage the user to complete their first order.');
      }
    } else if (actionType === 'add-recipient') {
      // User has no recipients
      const message = `Send reminder to ${customer.name} (${customer.email}) to add recipients?\n\nThey signed up ${customer.daysSinceSignup} days ago but haven't added any recipients yet.`;
      if (confirm(message)) {
        // TODO: Implement email/notification API
        alert('Reminder functionality coming soon! This will send an email to encourage the user to add recipients.');
      }
    }
  };

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin - Customers</title>
      </Head>

      <PageHeader
        icon={Users}
        title="Customer Analytics"
        subtitle={`${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}`}
      />

      {/* Segment Filters */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {[
          { value: 'all', label: 'All Customers' },
          { value: 'vip', label: 'VIP ($50+ & 3+ orders)' },
          { value: 'loyal', label: 'Loyal (5+ orders)' },
          { value: 'active', label: 'Active (last 30 days)' },
          { value: 'at-risk', label: 'At Risk (inactive 30+ days)' },
          { value: 'one-time', label: 'One-time Customers' },
          { value: 'new', label: 'New (last 7 days)' },
          { value: 'abandoned', label: 'Abandoned Accounts', color: '#b42318' },
        ].map(seg => (
          <button
            key={seg.value}
            onClick={() => setSegment(seg.value)}
            style={{
              padding: '8px 16px',
              fontSize: '14px',
              backgroundColor: segment === seg.value ? (seg.color || '#3f3ccc') : 'white',
              color: segment === seg.value ? 'white' : (seg.color || '#3f3ccc'),
              border: `1px solid ${seg.color || '#3f3ccc'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: segment === seg.value ? 'bold' : 'normal',
            }}
          >
            {seg.label}
          </button>
        ))}
      </div>

      {/* Unsubscribed Filter */}
      <div style={{ marginBottom: '20px' }}>
        <label style={{
          display: 'inline-flex',
          alignItems: 'center',
          cursor: 'pointer',
          padding: '8px 12px',
          backgroundColor: showUnsubscribedOnly ? '#fff3e0' : '#f7f8f9',
          border: showUnsubscribedOnly ? '2px solid #ff9800' : '1px solid #ddd',
          borderRadius: '4px',
          fontSize: '14px',
          fontWeight: showUnsubscribedOnly ? 'bold' : 'normal',
        }}>
          <input
            type="checkbox"
            checked={showUnsubscribedOnly}
            onChange={(e) => setShowUnsubscribedOnly(e.target.checked)}
            style={{ marginRight: '8px', cursor: 'pointer' }}
          />
          <span>⛔ Show only unsubscribed users</span>
        </label>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} style={{ marginBottom: '20px' }}>
        <input
          type="text"
          placeholder="Search by name or email..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{
            padding: '10px',
            width: '400px',
            fontSize: '14px',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '10px 20px',
            marginLeft: '10px',
            fontSize: '14px',
            backgroundColor: '#3f3ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Search
        </button>
        {search && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearch('');
            }}
            style={{
              padding: '10px 20px',
              marginLeft: '10px',
              fontSize: '14px',
              backgroundColor: '#636a78',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading || loading}
          style={{
            padding: '10px 20px',
            marginLeft: '10px',
            fontSize: '14px',
            backgroundColor: downloading ? '#636a78' : '#0f7a52',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: downloading || loading ? 'not-allowed' : 'pointer',
          }}
        >
          {downloading ? 'Downloading...' : '⬇ Download CSV'}
        </button>
      </form>

      {/* Loading/Error States */}
      {loading && <div style={{ textAlign: 'center', padding: '40px' }}>Loading customers...</div>}
      {error && (
        <div style={{
          backgroundColor: '#fbf0dc',
          border: '1px solid #a05a00',
          borderRadius: '8px',
          padding: '20px',
          margin: '20px 0',
        }}>
          <h3 style={{ color: '#a05a00', marginTop: 0 }}>⚠️ Error Loading Customers</h3>
          <div style={{ color: '#a05a00', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '12px' }}>
            {error}
          </div>
        </div>
      )}

      {/* Customers Table */}
      {!loading && !error && customers.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#636a78' }}>
          No customers found
        </div>
      )}

      {!loading && !error && customers.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            border: '1px solid #ddd',
            backgroundColor: 'white',
          }}>
            <thead>
              <tr style={{ backgroundColor: '#f7f8f9' }}>
                <SortableTh label="Name" sortKey="name" sortConfig={sortConfig} onSort={handleSort} />
                <th style={headerStyle}>Email</th>
                {segment === 'abandoned' ? (
                  <>
                    <SortableTh label="Account Created" sortKey="accountCreatedAt" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableTh label="Days Since Signup" sortKey="daysSinceSignup" sortConfig={sortConfig} onSort={handleSort} />
                    <th style={headerStyle}>Recipients</th>
                    <th style={headerStyle}>Status</th>
                    <th style={headerStyle}>Email</th>
                    <th style={headerStyle}>Actions</th>
                  </>
                ) : (
                  <>
                    <SortableTh label="Orders" sortKey="orderCount" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableTh label="First Transaction" sortKey="firstOrderDate" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableTh label="Last Transaction" sortKey="lastOrderDate" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableTh label="Days Since Last Order" sortKey="daysSinceLastOrder" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableTh label="Total Spent" sortKey="totalSpent" sortConfig={sortConfig} onSort={handleSort} />
                    <SortableTh label="Avg Order" sortKey="avgOrderValue" sortConfig={sortConfig} onSort={handleSort} />
                    <th style={headerStyle}>Source</th>
                    <th style={headerStyle}>Segment</th>
                    <th style={headerStyle}>Email</th>
                    <th style={headerStyle}>Action</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedCustomers.map((customer) => {
                const seg = getCustomerSegment(customer);
                const isAbandoned = segment === 'abandoned';

                return (
                  <tr key={customer.email} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={cellStyle}>
                      {isAbandoned ? (
                        customer.name
                      ) : (
                        <button
                          onClick={() => handleCustomerClick(customer)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#3f3ccc',
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: '500',
                            padding: 0,
                          }}
                        >
                          {customer.name}
                        </button>
                      )}
                    </td>
                    <td style={cellStyle}>{customer.email}</td>
                    {isAbandoned ? (
                      <>
                        <td style={cellStyle}>{formatDate(customer.accountCreatedAt)}</td>
                        <td style={cellStyle}>
                          {customer.daysSinceSignup != null ? `${customer.daysSinceSignup} days` : 'N/A'}
                        </td>
                        <td style={cellStyle}>
                          {customer.hasRecipients ? (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              backgroundColor: '#e6f4ec',
                              color: '#0f7a52',
                              fontWeight: '500',
                            }}>
                              {customer.recipientCount} recipient{customer.recipientCount !== 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              backgroundColor: '#eef0f3',
                              color: '#636a78',
                              fontWeight: '500',
                            }}>
                              No recipients
                            </span>
                          )}
                        </td>
                        <td style={cellStyle}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            backgroundColor: '#fbe8e6',
                            color: '#b42318',
                            fontWeight: '500',
                          }}>
                            Never Ordered
                          </span>
                        </td>
                        <td style={cellStyle}>
                          {customer.emailUnsubscribed ? (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              backgroundColor: '#fbe8e6',
                              color: '#b42318',
                              fontWeight: '500',
                            }} title={`Unsubscribed on ${formatDate(customer.unsubscribedAt)}`}>
                              ⛔ Unsubscribed
                            </span>
                          ) : (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              backgroundColor: '#e6f4ec',
                              color: '#0f7a52',
                              fontWeight: '500',
                            }}>
                              ✓ Subscribed
                            </span>
                          )}
                        </td>
                        <td style={cellStyle}>
                          {customer.hasRecipients ? (
                            <button
                              onClick={() => handleAbandonedAction(customer, 'remind-complete')}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                backgroundColor: '#a05a00',
                                color: '#000',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: '500',
                              }}
                              title="Remind user to complete their first order"
                            >
                              Remind to Complete Order
                            </button>
                          ) : (
                            <button
                              onClick={() => handleAbandonedAction(customer, 'add-recipient')}
                              style={{
                                padding: '6px 12px',
                                fontSize: '12px',
                                backgroundColor: '#3f3ccc',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: '500',
                              }}
                              title="Remind user to add recipients"
                            >
                              Remind to Add Recipients
                            </button>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={cellStyle}>{customer.orderCount}</td>
                        <td style={cellStyle}>{formatDate(customer.firstOrderDate)}</td>
                        <td style={cellStyle}>{formatDate(customer.lastOrderDate)}</td>
                        <td style={cellStyle}>
                          {customer.daysSinceLastOrder !== null ? `${customer.daysSinceLastOrder} days` : 'N/A'}
                        </td>
                        <td style={cellStyle}>{formatCurrency(customer.totalSpent)}</td>
                        <td style={cellStyle}>{formatCurrency(customer.avgOrderValue)}</td>
                        <td style={{ ...cellStyle, color: customer.attribution ? '#2D2A26' : '#8A8279' }}>
                          {formatAttribution(customer.attribution)}
                        </td>
                        <td style={cellStyle}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            backgroundColor: seg.bgColor,
                            color: seg.color,
                            fontWeight: '500',
                          }}>
                            {seg.label}
                          </span>
                        </td>
                        <td style={cellStyle}>
                          {customer.emailUnsubscribed ? (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              backgroundColor: '#fbe8e6',
                              color: '#b42318',
                              fontWeight: '500',
                            }} title={`Unsubscribed on ${formatDate(customer.unsubscribedAt)}`}>
                              ⛔ Unsubscribed
                            </span>
                          ) : (
                            <span style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              fontSize: '12px',
                              backgroundColor: '#e6f4ec',
                              color: '#0f7a52',
                              fontWeight: '500',
                            }}>
                              ✓ Subscribed
                            </span>
                          )}
                        </td>
                        <td style={cellStyle}>
                          <EngagementAction
                            customer={customer}
                            onSend={openSendPreview}
                          />
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Customer Orders Modal */}
      <Modal
        open={!!(showOrdersModal && selectedCustomer)}
        onClose={closeOrdersModal}
        title={selectedCustomer?.name}
        subtitle={selectedCustomer?.email}
        maxWidth="max-w-[1200px]"
      >
        {selectedCustomer ? (
          <>

            {/* Customer Stats */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '20px',
              marginBottom: '20px',
              padding: '15px',
              backgroundColor: '#f7f8f9',
              borderRadius: '4px'
            }}>
              <div><strong>Total Orders:</strong> {selectedCustomer.orderCount}</div>
              <div><strong>Total Spent:</strong> {formatCurrency(selectedCustomer.totalSpent)}</div>
              <div><strong>Avg Order:</strong> {formatCurrency(selectedCustomer.avgOrderValue)}</div>
              <div><strong>First Order:</strong> {formatDate(selectedCustomer.firstOrderDate)}</div>
              <div><strong>Last Order:</strong> {formatDate(selectedCustomer.lastOrderDate)}</div>
              <div>
                <strong>Segment:</strong>{' '}
                {(() => {
                  const seg = getCustomerSegment(selectedCustomer);
                  return (
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      backgroundColor: seg.bgColor,
                      color: seg.color,
                      fontWeight: '500',
                    }}>
                      {seg.label}
                    </span>
                  );
                })()}
              </div>
              <div>
                <strong>Source:</strong>{' '}
                <span style={{ color: selectedCustomer.attribution ? '#2D2A26' : '#8A8279' }}>
                  {formatAttribution(selectedCustomer.attribution)}
                </span>
              </div>
            </div>

            {/* Orders Table */}
            <h3>Order History</h3>
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
                    <th style={headerStyle}>Restaurant</th>
                    <th style={headerStyle}>Amount</th>
                    <th style={headerStyle}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedCustomer.orders
                    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                    .map((order) => (
                      <tr key={order.id} style={{ borderBottom: '1px solid #ddd' }}>
                        <td style={cellStyle}>{formatDate(order.createdAt)}</td>
                        <td style={cellStyle}>
                          <div>{order.recipient?.name || 'N/A'}</div>
                          <div style={{ fontSize: '12px', color: '#636a78' }}>{order.recipient?.phone}</div>
                        </td>
                        <td style={cellStyle}>{order.restaurantName || 'N/A'}</td>
                        <td style={cellStyle}>{formatCurrency(order.totalAmount)}</td>
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
          </>
        ) : null}
      </Modal>

      {/* Engagement Email Preview Modal */}
      <Modal
        open={!!previewModal}
        onClose={closePreview}
        title={
          previewModal
            ? previewModal.campaignType === 'winback'
              ? 'Win-Back Email Preview'
              : 'Feedback Email Preview'
            : ''
        }
        subtitle={
          previewModal
            ? `To: ${previewModal.customer.email}${previewModal.subject ? ` · Subject: ${previewModal.subject}` : ''}`
            : ''
        }
        maxWidth="max-w-[640px]"
      >
        {previewModal ? (
          <div>
            {previewModal.loading ? (
              <div style={{ padding: '60px 0', textAlign: 'center', color: '#636a78', fontSize: '13px' }}>
                Loading preview…
              </div>
            ) : previewModal.error && !previewModal.html ? (
              <div style={{ padding: '12px', borderRadius: '6px', background: '#fbe8e6', color: '#b42318', fontSize: '13px' }}>
                {previewModal.error}
              </div>
            ) : (
              <>
                <div style={{ overflow: 'hidden', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
                  <iframe
                    srcDoc={previewModal.html}
                    title="Email Preview"
                    style={{ width: '100%', height: '500px', border: 0, display: 'block' }}
                  />
                </div>

                {previewModal.error ? (
                  <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '6px', background: '#fbe8e6', color: '#b42318', fontSize: '13px' }}>
                    {previewModal.error}
                  </div>
                ) : null}

                {previewModal.success ? (
                  <div style={{ marginTop: '12px', padding: '10px 12px', borderRadius: '6px', background: '#e6f4ec', color: '#0f7a52', fontSize: '13px', fontWeight: 500 }}>
                    ✓ Sent to {previewModal.customer.email}
                  </div>
                ) : null}

                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={closePreview}
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      backgroundColor: '#fff',
                      color: '#374151',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 500,
                    }}
                  >
                    {previewModal.success ? 'Close' : 'Cancel'}
                  </button>
                  {!previewModal.success ? (
                    <button
                      type="button"
                      onClick={confirmSend}
                      disabled={previewModal.sending}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        backgroundColor: previewModal.sending ? '#9aa1ad' : '#117150',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: previewModal.sending ? 'not-allowed' : 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {previewModal.sending ? 'Sending…' : 'Confirm & send'}
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}
      </Modal>
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

const SORT_ACCESSORS = {
  name: (c) => (c.name || '').toLowerCase(),
  orderCount: (c) => c.orderCount,
  firstOrderDate: (c) => (c.firstOrderDate ? new Date(c.firstOrderDate).getTime() : null),
  lastOrderDate: (c) => (c.lastOrderDate ? new Date(c.lastOrderDate).getTime() : null),
  daysSinceLastOrder: (c) => c.daysSinceLastOrder,
  totalSpent: (c) => (c.totalSpent != null ? parseFloat(c.totalSpent) : null),
  avgOrderValue: (c) => (c.avgOrderValue != null ? parseFloat(c.avgOrderValue) : null),
  accountCreatedAt: (c) => (c.accountCreatedAt ? new Date(c.accountCreatedAt).getTime() : null),
  daysSinceSignup: (c) => c.daysSinceSignup,
};

function SortableTh({ label, sortKey, sortConfig, onSort }) {
  const active = sortConfig.key === sortKey;
  const indicator = active ? (sortConfig.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return (
    <th
      style={{ ...headerStyle, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => onSort(sortKey)}
      role="button"
      aria-sort={active ? (sortConfig.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span style={{ color: active ? '#3f3ccc' : '#9aa1ad' }}>{indicator || ' ⇅'}</span>
    </th>
  );
}

const COOLDOWN_DAYS = 60;
const INACTIVE_DAYS_THRESHOLD = 30;

const WINBACK_CAMPAIGN = { campaignType: 'winback', label: 'Send Win-Back', bg: '#117150' };
const FEEDBACK_CAMPAIGN = { campaignType: 'feedback', label: 'Request Feedback', bg: '#a05a00' };

// Behavior-driven gate. Independent of segment label so lapsed VIPs / Loyals
// get the win-back button too, not just customers tagged "At Risk".
function pickEngagementCampaign(customer) {
  const orderCount = customer.orderCount || 0;
  const daysSince = customer.daysSinceLastOrder;
  if (orderCount >= 2 && daysSince != null && daysSince >= INACTIVE_DAYS_THRESHOLD) {
    return WINBACK_CAMPAIGN;
  }
  if (orderCount === 1) {
    return FEEDBACK_CAMPAIGN;
  }
  return null;
}

function isWithinCooldown(sentAt, days = COOLDOWN_DAYS) {
  if (!sentAt) return false;
  const ms = typeof sentAt === 'string' ? Date.parse(sentAt) : Number(sentAt);
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms < days * 24 * 60 * 60 * 1000;
}

function formatShortDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function EngagementAction({ customer, onSend }) {
  const config = pickEngagementCampaign(customer);
  if (!config) return <span style={{ color: '#9aa1ad' }}>—</span>;

  const lastSentAt = customer.engagementHistory?.[config.campaignType]?.sentAt;
  const cooled = isWithinCooldown(lastSentAt);
  const unsubscribed = !!customer.emailUnsubscribed;
  const disabled = cooled || unsubscribed;

  let title;
  if (unsubscribed) title = 'Customer is unsubscribed';
  else if (cooled) title = `Sent on ${formatShortDate(lastSentAt)} — ${COOLDOWN_DAYS}-day cooldown`;
  else title = `Preview & send ${config.label.toLowerCase()} email`;

  const buttonLabel = cooled ? `Sent ${formatShortDate(lastSentAt)}` : config.label;

  return (
    <button
      onClick={() => onSend(customer, config.campaignType)}
      disabled={disabled}
      title={title}
      style={{
        padding: '6px 12px',
        fontSize: '12px',
        backgroundColor: disabled ? '#eef0f3' : config.bg,
        color: disabled ? '#636a78' : '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: '500',
        whiteSpace: 'nowrap',
      }}
    >
      {buttonLabel}
    </button>
  );
}

export const getServerSideProps = withAuth();
