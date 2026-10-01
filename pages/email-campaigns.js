import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { withAuth } from '../lib/withAuth';
import { Banner } from '@cloudflare/kumo';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';

const COHORTS = [
  { value: 'all', label: 'All Users', description: 'Everyone in the database' },
  { value: 'vip', label: 'VIP', description: '$50+ spent AND 3+ orders' },
  { value: 'loyal', label: 'Loyal', description: '5+ orders' },
  { value: 'active', label: 'Active', description: 'Ordered in last 30 days' },
  { value: 'at-risk', label: 'At Risk', description: 'No order in 30+ days but has ordered before' },
  { value: 'churned', label: 'Churned', description: 'No order in 60+ days' },
  { value: 'one-time', label: 'One-time', description: 'Exactly 1 order' },
  { value: 'new', label: 'New', description: 'Signed up in last 7 days' },
  { value: 'never-ordered', label: 'Never Ordered', description: 'Registered but no orders' },
];

export default function EmailCampaignsPage() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [environment, setEnvironment] = useState('dev');
  const [refreshing, setRefreshing] = useState(false);

  // Templates state
  const [templates, setTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);

  // Campaigns state
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(true);

  // Campaign creation state
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [variables, setVariables] = useState({});
  const [cohort, setCohort] = useState('all');
  const [campaignName, setCampaignName] = useState('');
  const [subject, setSubject] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [ctaUrl, setCtaUrl] = useState('https://foodtoindia.com');

  // Test send state
  const [testEmails, setTestEmails] = useState('');
  const [sendingTest, setSendingTest] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testSent, setTestSent] = useState(false);

  // Production send state
  const [sendingCampaign, setSendingCampaign] = useState(false);
  const [campaignResult, setCampaignResult] = useState(null);

  // Saving state
  const [saving, setSaving] = useState(false);

  // Error state
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchEnvironment();
    fetchTemplates();
    fetchCampaigns();
  }, []);

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

  const fetchTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const response = await fetch('/api/email-templates');
      if (response.ok) {
        const data = await response.json();
        setTemplates(data.templates || []);
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const fetchCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const response = await fetch('/api/email-campaigns');
      if (response.ok) {
        const data = await response.json();
        setCampaigns(data.campaigns || []);
      }
    } catch (err) {
      console.error('Failed to fetch campaigns:', err);
    } finally {
      setLoadingCampaigns(false);
    }
  };

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

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchTemplates(), fetchCampaigns()]);
    } finally {
      setRefreshing(false);
    }
  };

  const handleTemplateSelect = (templateId) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(template);
      setSubject(template.subject);

      // Initialize variables with default placeholder values
      const initialVars = {};
      (template.variables || []).forEach(v => {
        // Set smart defaults for common variables
        switch (v) {
          case 'FIRST_NAME':
            initialVars[v] = '';
            break;
          case 'PROMO_CODE':
            initialVars[v] = promoCode || 'WELCOME5';
            break;
          case 'CTA_URL':
            initialVars[v] = ctaUrl;
            break;
          case 'OCCASION':
            initialVars[v] = "Valentine's Day";
            break;
          case 'WEEKS':
            initialVars[v] = '2';
            break;
          case 'DAYS':
            initialVars[v] = '3';
            break;
          case 'DATE':
            initialVars[v] = 'February 14';
            break;
          case 'FOOD_TYPE':
            initialVars[v] = 'cakes and sweets';
            break;
          case 'VENDOR_TYPE':
            initialVars[v] = 'bakeries';
            break;
          case 'ACTION_VERB':
            initialVars[v] = 'celebrate';
            break;
          case 'DISCOUNT_AMOUNT':
            initialVars[v] = '$10';
            break;
          case 'UNSUBSCRIBE_URL':
            initialVars[v] = 'https://foodtoindia.com/unsubscribe';
            break;
          default:
            initialVars[v] = `[${v}]`;
        }
      });
      setVariables(initialVars);

      // Reset test state when changing template
      setTestSent(false);
      setTestResult(null);
      setCampaignResult(null);
    } else {
      setSelectedTemplate(null);
      setVariables({});
      setSubject('');
    }
  };

  // Sync promo code and CTA URL to variables
  useEffect(() => {
    if (selectedTemplate && variables.PROMO_CODE !== undefined) {
      setVariables(prev => ({ ...prev, PROMO_CODE: promoCode || prev.PROMO_CODE }));
    }
  }, [promoCode]);

  useEffect(() => {
    if (selectedTemplate && variables.CTA_URL !== undefined) {
      setVariables(prev => ({ ...prev, CTA_URL: ctaUrl }));
    }
  }, [ctaUrl]);

  // Generate preview HTML with variables replaced
  const previewHtml = useMemo(() => {
    if (!selectedTemplate) return '';
    let html = selectedTemplate.htmlContent;
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      html = html.replace(regex, value ?? `[${key}]`);
    });
    // Clean up empty greetings when FIRST_NAME is blank (e.g., "Hi ," → "Hey,")
    html = html.replace(/(Hi|Hey|Hello)\s+,/g, 'Hey,');
    return html;
  }, [selectedTemplate, variables]);

  // Generate preview subject with variables replaced
  const previewSubject = useMemo(() => {
    if (!subject) return '';
    let s = subject;
    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      s = s.replace(regex, value ?? `[${key}]`);
    });
    return s;
  }, [subject, variables]);

  const handleSendTest = async () => {
    if (!selectedTemplate) {
      alert('Please select a template first');
      return;
    }

    const emails = testEmails.split(',').map(e => e.trim()).filter(e => e);
    if (emails.length === 0) {
      alert('Please enter at least one test email address');
      return;
    }

    setSendingTest(true);
    setTestResult(null);
    setError(null);

    try {
      const response = await fetch('/api/email-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          templateId: selectedTemplate.id,
          subject: subject,
          variables: variables,
          recipientEmails: emails,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send test email');
      }

      setTestResult(data);
      setTestSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingTest(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!selectedTemplate) {
      alert('Please select a template first');
      return;
    }

    if (!campaignName.trim()) {
      alert('Please enter a campaign name');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch('/api/email-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          name: campaignName,
          templateId: selectedTemplate.id,
          templateSlug: selectedTemplate.slug,
          subject: subject,
          variables: variables,
          cohort: cohort,
          promoCode: promoCode,
          ctaUrl: ctaUrl,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save campaign');
      }

      alert('Campaign saved as draft!');
      await fetchCampaigns();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendCampaign = async () => {
    if (!selectedTemplate) {
      alert('Please select a template first');
      return;
    }

    if (!testSent) {
      alert('You must send a test email first before sending a production campaign');
      return;
    }

    const cohortInfo = COHORTS.find(c => c.value === cohort);
    const confirmMessage = `Are you sure you want to send this campaign to the "${cohortInfo.label}" cohort (${cohortInfo.description})?\n\nThis action cannot be undone.`;

    if (!confirm(confirmMessage)) {
      return;
    }

    setSendingCampaign(true);
    setCampaignResult(null);
    setError(null);

    try {
      const response = await fetch('/api/email-campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          templateId: selectedTemplate.id,
          subject: subject,
          variables: variables,
          cohort: cohort,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send campaign');
      }

      setCampaignResult(data);
      await fetchCampaigns();
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingCampaign(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusColor = (status) => {
    const colors = {
      draft: { bg: '#eef0f3', color: '#444b57' },
      sending: { bg: '#fbf0dc', color: '#a05a00' },
      sent: { bg: '#e6f4ec', color: '#0f7a52' },
      failed: { bg: '#fbe8e6', color: '#b42318' },
    };
    return colors[status] || colors.draft;
  };

  const getCohortLabel = (value) => {
    const c = COHORTS.find(c => c.value === value);
    return c ? c.label : value;
  };

  const activeTemplates = templates.filter(t => t.isActive !== false);

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin - Email Campaigns</title>
      </Head>

      <PageHeader
        icon={PaperPlaneTilt}
        title="Email Campaigns"
        subtitle="Create and send email campaigns to customer segments"
      />

      {error ? (
        <Banner variant="danger" className="mb-5">
          {error}
        </Banner>
      ) : null}

      {/* Campaign Creation Section */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 400px',
        gap: '20px',
        marginBottom: '40px',
      }}>
        {/* Left Panel: Preview */}
        <div style={{
          backgroundColor: '#f7f8f9',
          border: '1px solid #ddd',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '15px',
            backgroundColor: '#eef0f3',
            borderBottom: '1px solid #ddd',
          }}>
            <h3 style={{ margin: 0 }}>Email Preview</h3>
            {selectedTemplate && (
              <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: '#636a78' }}>
                <strong>Subject:</strong> {previewSubject || '[No subject]'}
              </p>
            )}
          </div>
          <div style={{ padding: '15px', minHeight: '500px' }}>
            {!selectedTemplate ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', color: '#8c93a0' }}>
                <p style={{ fontSize: '48px', margin: '0 0 20px 0' }}>📧</p>
                <p>Select a template to see preview</p>
              </div>
            ) : (
              <div style={{ backgroundColor: 'white', borderRadius: '4px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <iframe
                  srcDoc={previewHtml}
                  style={{ width: '100%', height: '550px', border: 'none' }}
                  title="Email Preview"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Configuration */}
        <div style={{
          backgroundColor: 'white',
          border: '1px solid #ddd',
          borderRadius: '8px',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '15px',
            backgroundColor: '#117150',
            color: 'white',
          }}>
            <h3 style={{ margin: 0 }}>Campaign Configuration</h3>
          </div>
          <div style={{ padding: '20px', maxHeight: '700px', overflowY: 'auto' }}>
            {/* Template Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={labelStyle}>Select Template *</label>
              {loadingTemplates ? (
                <p style={{ color: '#636a78' }}>Loading templates...</p>
              ) : activeTemplates.length === 0 ? (
                <p style={{ color: '#636a78' }}>
                  No templates available.{' '}
                  <Link legacyBehavior href="/email-templates">
                    <a style={{ color: '#3f3ccc' }}>Create one</a>
                  </Link>
                </p>
              ) : (
                <select
                  value={selectedTemplate?.id || ''}
                  onChange={(e) => handleTemplateSelect(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">-- Select a template --</option>
                  {activeTemplates.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.category})
                    </option>
                  ))}
                </select>
              )}
            </div>

            {selectedTemplate && (
              <>
                {/* Campaign Name */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>Campaign Name</label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g., Valentine's Day 2026"
                    style={inputStyle}
                  />
                  <p style={helpTextStyle}>For internal tracking only</p>
                </div>

                {/* Subject Line */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>Subject Line *</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                {/* Cohort Selection */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>Target Audience *</label>
                  <select
                    value={cohort}
                    onChange={(e) => setCohort(e.target.value)}
                    style={inputStyle}
                  >
                    {COHORTS.map(c => (
                      <option key={c.value} value={c.value}>
                        {c.label} - {c.description}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Promo Code */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>Promo Code</label>
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="e.g., VALENTINE5"
                    style={inputStyle}
                  />
                </div>

                {/* CTA URL */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={labelStyle}>CTA URL</label>
                  <input
                    type="url"
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    placeholder="https://foodtoindia.com"
                    style={inputStyle}
                  />
                </div>

                {/* Template Variables */}
                {(selectedTemplate.variables || []).length > 0 && (
                  <div style={{
                    marginBottom: '20px',
                    padding: '15px',
                    backgroundColor: '#f7f8f9',
                    borderRadius: '6px',
                  }}>
                    <h4 style={{ margin: '0 0 15px 0', fontSize: '14px' }}>Template Variables</h4>
                    {(selectedTemplate.variables || []).map(v => (
                      <div key={v} style={{ marginBottom: '12px' }}>
                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 'bold', marginBottom: '4px', color: '#636a78' }}>
                          {v}
                        </label>
                        <input
                          type="text"
                          value={variables[v] || ''}
                          onChange={(e) => setVariables({ ...variables, [v]: e.target.value })}
                          style={{ ...inputStyle, fontSize: '13px', padding: '8px' }}
                        />
                      </div>
                    ))}
                  </div>
                )}

                {/* Divider */}
                <hr style={{ margin: '25px 0', border: 'none', borderTop: '1px solid #ddd' }} />

                {/* Test Send Section */}
                <div style={{
                  marginBottom: '20px',
                  padding: '15px',
                  backgroundColor: '#e3f2fd',
                  borderRadius: '6px',
                  border: '1px solid #90caf9',
                }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#1565c0' }}>
                    Step 1: Send Test Email
                  </h4>
                  <p style={{ fontSize: '12px', color: '#636a78', margin: '0 0 10px 0' }}>
                    Always test before sending to production.
                  </p>
                  <input
                    type="text"
                    value={testEmails}
                    onChange={(e) => setTestEmails(e.target.value)}
                    placeholder="test@example.com, admin@example.com"
                    style={{ ...inputStyle, fontSize: '13px', marginBottom: '10px' }}
                  />
                  <button
                    onClick={handleSendTest}
                    disabled={sendingTest}
                    style={{
                      width: '100%',
                      padding: '10px',
                      backgroundColor: sendingTest ? '#ccc' : '#1976d2',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: sendingTest ? 'not-allowed' : 'pointer',
                      fontWeight: '600',
                    }}
                  >
                    {sendingTest ? 'Sending...' : '📤 Send Test Email'}
                  </button>
                  {testResult && (
                    <div style={{
                      marginTop: '10px',
                      padding: '10px',
                      backgroundColor: testResult.success ? '#c8e6c9' : '#ffcdd2',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}>
                      {testResult.mock && <strong>[MOCK] </strong>}
                      {testResult.message}
                    </div>
                  )}
                </div>

                {/* Save Draft */}
                <button
                  onClick={handleSaveDraft}
                  disabled={saving}
                  style={{
                    width: '100%',
                    padding: '12px',
                    backgroundColor: saving ? '#ccc' : '#636a78',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontWeight: '600',
                    marginBottom: '10px',
                  }}
                >
                  {saving ? 'Saving...' : '💾 Save as Draft'}
                </button>

                {/* Production Send */}
                <div style={{
                  padding: '15px',
                  backgroundColor: testSent ? '#fff3e0' : '#f5f5f5',
                  borderRadius: '6px',
                  border: `1px solid ${testSent ? '#ffcc80' : '#e0e3e8'}`,
                }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: testSent ? '#e65100' : '#8c93a0' }}>
                    Step 2: Send Campaign
                  </h4>
                  {!testSent ? (
                    <p style={{ fontSize: '12px', color: '#8c93a0', margin: 0 }}>
                      You must send a test email first.
                    </p>
                  ) : (
                    <>
                      <p style={{ fontSize: '12px', color: '#636a78', margin: '0 0 10px 0' }}>
                        Ready to send to <strong>{getCohortLabel(cohort)}</strong> cohort.
                      </p>
                      <button
                        onClick={handleSendCampaign}
                        disabled={sendingCampaign}
                        style={{
                          width: '100%',
                          padding: '12px',
                          backgroundColor: sendingCampaign ? '#ccc' : '#e65100',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: sendingCampaign ? 'not-allowed' : 'pointer',
                          fontWeight: '600',
                        }}
                      >
                        {sendingCampaign ? 'Sending...' : '🚀 Send Campaign'}
                      </button>
                    </>
                  )}
                  {campaignResult && (
                    <div style={{
                      marginTop: '10px',
                      padding: '10px',
                      backgroundColor: campaignResult.success ? '#c8e6c9' : '#ffcdd2',
                      borderRadius: '4px',
                      fontSize: '12px',
                    }}>
                      {campaignResult.message}
                      {campaignResult.sentCount !== undefined && (
                        <p style={{ margin: '5px 0 0 0' }}>
                          Sent: {campaignResult.sentCount} | Failed: {campaignResult.failedCount}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Past Campaigns Table */}
      <div>
        <h2>Past Campaigns</h2>
        {loadingCampaigns ? (
          <p style={{ color: '#636a78' }}>Loading campaigns...</p>
        ) : campaigns.length === 0 ? (
          <p style={{ color: '#636a78' }}>No campaigns yet. Create your first one above!</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              border: '1px solid #ddd',
              backgroundColor: 'white',
            }}>
              <thead>
                <tr style={{ backgroundColor: '#f7f8f9' }}>
                  <th style={headerStyle}>Name</th>
                  <th style={headerStyle}>Template</th>
                  <th style={headerStyle}>Cohort</th>
                  <th style={headerStyle}>Status</th>
                  <th style={headerStyle}>Recipients</th>
                  <th style={headerStyle}>Sent</th>
                  <th style={headerStyle}>Created</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => {
                  const statusColor = getStatusColor(campaign.status);
                  return (
                    <tr key={campaign.id} style={{ borderBottom: '1px solid #ddd' }}>
                      <td style={cellStyle}>
                        <strong>{campaign.name || 'Untitled'}</strong>
                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#636a78' }}>
                          {campaign.subject}
                        </p>
                      </td>
                      <td style={cellStyle}>
                        <code style={{ fontSize: '11px', backgroundColor: '#f0f0f0', padding: '2px 6px', borderRadius: '3px' }}>
                          {campaign.templateSlug || campaign.templateId}
                        </code>
                      </td>
                      <td style={cellStyle}>{getCohortLabel(campaign.cohort)}</td>
                      <td style={cellStyle}>
                        <span style={{
                          padding: '4px 8px',
                          borderRadius: '4px',
                          fontSize: '12px',
                          backgroundColor: statusColor.bg,
                          color: statusColor.color,
                          textTransform: 'capitalize',
                        }}>
                          {campaign.status}
                        </span>
                      </td>
                      <td style={cellStyle}>
                        {campaign.status === 'sent' ? (
                          <span>
                            {campaign.sentCount}/{campaign.recipientCount}
                            {campaign.failedCount > 0 && (
                              <span style={{ color: '#b42318', marginLeft: '5px' }}>
                                ({campaign.failedCount} failed)
                              </span>
                            )}
                          </span>
                        ) : (
                          <span style={{ color: '#8c93a0' }}>-</span>
                        )}
                      </td>
                      <td style={cellStyle}>{formatDate(campaign.sentAt)}</td>
                      <td style={cellStyle}>{formatDate(campaign.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

const labelStyle = {
  display: 'block',
  marginBottom: '6px',
  fontWeight: 'bold',
  fontSize: '13px',
};

const inputStyle = {
  width: '100%',
  padding: '10px',
  fontSize: '14px',
  border: '1px solid #ddd',
  borderRadius: '4px',
  boxSizing: 'border-box',
};

const helpTextStyle = {
  margin: '4px 0 0 0',
  fontSize: '11px',
  color: '#8c93a0',
};

const headerStyle = {
  padding: '12px 8px',
  textAlign: 'left',
  fontWeight: 'bold',
  fontSize: '13px',
  borderBottom: '2px solid #ddd',
};

const cellStyle = {
  padding: '12px 8px',
  fontSize: '13px',
  verticalAlign: 'top',
};

export const getServerSideProps = withAuth();
