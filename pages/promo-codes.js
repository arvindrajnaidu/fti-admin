import { useEffect, useState } from 'react';
import Head from 'next/head';
import { Banner, Button, Field, Input, Label, Loader } from '@cloudflare/kumo';
import { withAuth } from '../lib/withAuth';
import { Ticket } from '@phosphor-icons/react';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import { TableShell, Th, Tr, Td, Pill } from '../components/data/DataTable';

const formatDate = (s) => {
  if (!s) return 'Never';
  return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};
const formatCurrency = (cents) => (!cents ? '—' : `$${(cents / 100).toFixed(2)}`);
const formatValue = (p) =>
  p.type === 'percent' ? `${p.value}%` : `$${(p.value / 100).toFixed(2)}`;
const isExpired = (s) => (s ? new Date(s) < new Date() : false);

const EMPTY_FORM = {
  code: '',
  type: 'percent',
  value: '',
  minOrderUSD: '',
  maxDiscountUSD: '',
  expiresAt: '',
};

export default function PromoCodesPage() {
  const [promoCodes, setPromoCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [environment, setEnvironment] = useState('dev');
  const [refreshing, setRefreshing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);

  useEffect(() => {
    fetchPromoCodes();
    fetch('/api/environment')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setEnvironment(d.environment))
      .catch(() => {});
  }, []);

  const fetchPromoCodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/promo-codes');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || 'Failed to fetch promo codes');
      }
      const data = await res.json();
      setPromoCodes((data.promoCodes || []).filter((p) => !p.isStoreCredit));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchPromoCodes();
    } finally {
      setRefreshing(false);
    }
  };

  const resetForm = () => {
    setFormData(EMPTY_FORM);
    setEditing(null);
    setShowForm(false);
    setFormError(null);
  };

  const openCreate = () => {
    setEditing(null);
    setFormData(EMPTY_FORM);
    setShowForm(true);
    setFormError(null);
  };

  const openEdit = (p) => {
    setEditing(p);
    setFormData({
      code: p.code,
      type: p.type,
      value: p.type === 'fixed' ? (p.value / 100).toFixed(2) : String(p.value),
      minOrderUSD: p.minOrderUSD ? (p.minOrderUSD / 100).toFixed(2) : '',
      maxDiscountUSD: p.maxDiscountUSD ? (p.maxDiscountUSD / 100).toFixed(2) : '',
      expiresAt: p.expiresAt ? p.expiresAt.split('T')[0] : '',
    });
    setShowForm(true);
    setFormError(null);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    const isEditing = editing !== null;
    try {
      const payload = {
        code: formData.code,
        type: formData.type,
        value:
          formData.type === 'fixed'
            ? Number(formData.value) * 100
            : Number(formData.value),
        minOrderUSD: formData.minOrderUSD ? Number(formData.minOrderUSD) * 100 : null,
        maxDiscountUSD: formData.maxDiscountUSD
          ? Number(formData.maxDiscountUSD) * 100
          : null,
        expiresAt: formData.expiresAt || null,
      };
      if (isEditing) payload.id = editing.id;
      const res = await fetch('/api/promo-codes', {
        method: isEditing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to ${isEditing ? 'update' : 'create'} promo code`);
      }
      resetForm();
      await fetchPromoCodes();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (p) => {
    try {
      const res = await fetch('/api/promo-codes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
      });
      if (!res.ok) throw new Error('Failed to update promo code');
      await fetchPromoCodes();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDelete = async (p) => {
    if (!confirm(`Delete promo code "${p.code}"?`)) return;
    try {
      const res = await fetch('/api/promo-codes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id }),
      });
      if (!res.ok) throw new Error('Failed to delete promo code');
      await fetchPromoCodes();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin — Promo Codes</title>
      </Head>

      <PageHeader
        icon={Ticket}
        title="Promo Codes"
        subtitle={`${promoCodes.length} ${promoCodes.length === 1 ? 'code' : 'codes'}`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              variant={showForm ? 'secondary' : 'primary'}
              size="sm"
              onClick={showForm ? resetForm : openCreate}
            >
              {showForm ? 'Cancel' : '+ New promo code'}
            </Button>
          </>
        }
      />

      {showForm ? (
        <div className="mb-8 rounded-[8px] bg-ink-50 p-5">
          <h3 className="mb-4 text-[13px] font-medium uppercase tracking-micro text-ink-500">
            {editing ? `Edit ${editing.code}` : 'New promo code'}
          </h3>
          {formError ? (
            <Banner variant="danger" className="mb-4">
              {formError}
            </Banner>
          ) : null}
          <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Field>
                <Label>Code</Label>
                <Input
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  placeholder="HOLI25"
                  required
                />
              </Field>
              <Field>
                <Label>Type</Label>
                <select
                  value={formData.type}
                  onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                  className="h-9 rounded-[6px] border border-ink-200 bg-ink-0 px-3 text-[13px] text-ink-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                >
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </Field>
              <Field>
                <Label>Value {formData.type === 'percent' ? '(%)' : '($)'}</Label>
                <Input
                  type="number"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  placeholder={formData.type === 'percent' ? '25' : '5.00'}
                  required
                  min="0"
                  max={formData.type === 'percent' ? '100' : undefined}
                  step={formData.type === 'percent' ? '1' : '0.01'}
                />
              </Field>
              <Field>
                <Label>Min order ($)</Label>
                <Input
                  type="number"
                  value={formData.minOrderUSD}
                  onChange={(e) => setFormData({ ...formData, minOrderUSD: e.target.value })}
                  placeholder="20"
                  min="0"
                  step="0.01"
                />
              </Field>
              <Field>
                <Label>Max discount ($)</Label>
                <Input
                  type="number"
                  value={formData.maxDiscountUSD}
                  onChange={(e) => setFormData({ ...formData, maxDiscountUSD: e.target.value })}
                  placeholder="10"
                  min="0"
                  step="0.01"
                />
              </Field>
              <Field>
                <Label>Expires at</Label>
                <Input
                  type="date"
                  value={formData.expiresAt}
                  onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                />
              </Field>
            </div>
            <div className="flex gap-2">
              <Button type="submit" variant="primary" size="sm" disabled={submitting}>
                {submitting
                  ? editing
                    ? 'Updating…'
                    : 'Creating…'
                  : editing
                  ? 'Update'
                  : 'Create'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {error ? (
        <Banner variant="danger" className="mb-6">
          {error}
        </Banner>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader />
        </div>
      ) : null}

      {!loading && !error && promoCodes.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[13px] text-ink-500">
            No promo codes yet. Create one to get started.
          </p>
        </div>
      ) : null}

      {!loading && !error && promoCodes.length > 0 ? (
        <TableShell>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Type</Th>
              <Th align="right">Value</Th>
              <Th align="right">Min order</Th>
              <Th align="right">Max discount</Th>
              <Th>Expires</Th>
              <Th align="right">Redemptions</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {promoCodes.map((p) => {
              const expired = isExpired(p.expiresAt);
              return (
                <Tr key={p.id}>
                  <Td>
                    <code className="font-mono text-[13px] font-medium text-ink-900">
                      {p.code}
                    </code>
                  </Td>
                  <Td>
                    <Pill tone={p.type === 'percent' ? 'accent' : 'success'}>
                      {p.type === 'percent' ? 'Percent' : 'Fixed'}
                    </Pill>
                  </Td>
                  <Td align="right" className="font-num font-medium">
                    {formatValue(p)}
                  </Td>
                  <Td align="right" className="font-num text-ink-600">
                    {formatCurrency(p.minOrderUSD)}
                  </Td>
                  <Td align="right" className="font-num text-ink-600">
                    {formatCurrency(p.maxDiscountUSD)}
                  </Td>
                  <Td className={expired ? 'text-danger' : 'text-ink-600'}>
                    {formatDate(p.expiresAt)}
                    {expired ? ' (expired)' : ''}
                  </Td>
                  <Td align="right" className="font-num">
                    {p.totalRedemptions || 0}
                  </Td>
                  <Td>
                    <Pill tone={p.isActive && !expired ? 'success' : 'danger'}>
                      {expired ? 'Expired' : p.isActive ? 'Active' : 'Inactive'}
                    </Pill>
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(p)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(p)}
                        disabled={expired}
                      >
                        {p.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(p)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </TableShell>
      ) : null}
    </AdminShell>
  );
}

export const getServerSideProps = withAuth();
