import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { withAuth } from '../lib/withAuth';
import { TrayArrowDown } from '@phosphor-icons/react';
import { AdminShell } from '../components/layout/AdminShell';
import { PageHeader } from '../components/layout/PageHeader';
import useIsMobile from '../lib/useIsMobile';

const getInactiveTab = (isMobile) => ({ padding: isMobile ? '8px 12px' : '10px 20px', textDecoration: 'none', color: '#636a78', borderBottom: '3px solid transparent', fontWeight: '500' });
const getActiveTab = (isMobile) => ({ padding: isMobile ? '8px 12px' : '10px 20px', textDecoration: 'none', color: '#3f3ccc', borderBottom: '3px solid #3f3ccc', fontWeight: 'bold' });

export default function InboxPage() {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [environment, setEnvironment] = useState('dev');
  const [refreshing, setRefreshing] = useState(false);

  // Email list state
  const [emails, setEmails] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Selected email state
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loadingEmail, setLoadingEmail] = useState(false);

  // Reply state
  const [replyText, setReplyText] = useState('');
  const [replyFrom, setReplyFrom] = useState('support@foodtoindia.com');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState(null);

  // Delete state
  const [deleting, setDeleting] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);

  // Compose state
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFrom, setComposeFrom] = useState('support@foodtoindia.com');
  const [composeAttachments, setComposeAttachments] = useState([]);
  const [composeSending, setComposeSending] = useState(false);
  const [composeResult, setComposeResult] = useState(null);
  const [composeUploading, setComposeUploading] = useState(false);
  const composeFileInputRef = useRef(null);

  // Attachment state (for replies)
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

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

  const fetchEmails = useCallback(async (cursor) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const url = cursor ? `/api/inbox?cursor=${cursor}` : '/api/inbox';
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (cursor) {
          setEmails(prev => [...prev, ...data.emails]);
        } else {
          setEmails(data.emails);
        }
        setUnreadCount(data.unreadCount);
        setNextCursor(data.nextCursor);
      }
    } catch (err) {
      console.error('Failed to fetch emails:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const fetchEmail = useCallback(async (id) => {
    setLoadingEmail(true);
    setSelectedEmail(null);
    try {
      const response = await fetch(`/api/inbox?id=${id}`);
      if (response.ok) {
        const data = await response.json();
        setSelectedEmail(data.email);
        // Fix #6: Only decrement unread count if this email was actually unread
        if (data.wasUnread) {
          setEmails(prev => prev.map(e => e.id === id ? { ...e, read: true } : e));
          setUnreadCount(prev => Math.max(0, prev - 1));
        }
      }
    } catch (err) {
      console.error('Failed to fetch email:', err);
    } finally {
      setLoadingEmail(false);
    }
  }, []);

  useEffect(() => {
    fetchEnvironment();
    fetchEmails();
  }, [fetchEmails]);

  useEffect(() => {
    if (selectedId) {
      fetchEmail(selectedId);
      setReplyText('');
      setAttachments([]);
      setSendResult(null);
    }
  }, [selectedId, fetchEmail]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchEmails().finally(() => setRefreshing(false));
    if (selectedId) fetchEmail(selectedId);
  };

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/inbox-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          content: base64,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setAttachments(prev => [...prev, data]);
      } else {
        const err = await response.json();
        alert('Upload failed: ' + (err.message || err.error));
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert('Upload failed');
    } finally {
      setUploading(false);
      // Reset file input so same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendReply = async () => {
    if (!replyText.trim() && attachments.length === 0) return;

    setSending(true);
    setSendResult(null);
    try {
      // Wrap plain text in simple HTML
      const replyHtml = `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6;">${replyText.replace(/\n/g, '<br>')}</div>`;

      const response = await fetch('/api/inbox-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emailId: selectedId,
          replyHtml,
          replyText: replyText.trim(),
          from: replyFrom,
          attachments: attachments.map(a => ({
            filename: a.filename,
            content: a.content,
            storageUrl: a.storageUrl,
          })),
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setSendResult({ type: 'success', message: 'Reply sent!' });
        setReplyText('');
        setAttachments([]);
        // Refresh the email to show the new reply
        fetchEmail(selectedId);
      } else {
        setSendResult({ type: 'error', message: data.message || data.error || 'Failed to send' });
      }
    } catch (err) {
      setSendResult({ type: 'error', message: 'Network error' });
    } finally {
      setSending(false);
    }
  };

  const handleMarkUnread = async () => {
    if (!selectedEmail || !selectedId) return;
    setMarkingUnread(true);
    try {
      const response = await fetch('/api/inbox', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId, read: false }),
      });
      if (response.ok) {
        setEmails(prev => prev.map(e => e.id === selectedId ? { ...e, read: false } : e));
        if (selectedEmail.read) {
          setUnreadCount(prev => prev + 1);
        }
        setSelectedEmail(prev => prev ? { ...prev, read: false } : prev);
      } else {
        const data = await response.json().catch(() => ({}));
        alert('Mark unread failed: ' + (data.message || data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Mark unread failed: network error');
    } finally {
      setMarkingUnread(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete this email?\n\nSubject: ${selectedEmail?.subject || '(no subject)'}\nFrom: ${selectedEmail?.from || 'Unknown'}`)) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch('/api/inbox', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId }),
      });

      if (response.ok) {
        // Remove from list and clear selection
        setEmails(prev => prev.filter(e => e.id !== selectedId));
        if (!selectedEmail?.read) {
          setUnreadCount(prev => Math.max(0, prev - 1));
        }
        setSelectedId(null);
        setSelectedEmail(null);
        if (isMobile) setMobileShowDetail(false);
      } else {
        const data = await response.json();
        alert('Delete failed: ' + (data.message || data.error));
      }
    } catch (err) {
      alert('Delete failed: network error');
    } finally {
      setDeleting(false);
    }
  };

  const startCompose = () => {
    setComposing(true);
    setSelectedId(null);
    setSelectedEmail(null);
    setComposeTo('');
    setComposeSubject('');
    setComposeBody('');
    setComposeAttachments([]);
    setComposeResult(null);
    if (isMobile) setMobileShowDetail(true);
  };

  const cancelCompose = () => {
    setComposing(false);
    setComposeResult(null);
    if (isMobile) setMobileShowDetail(false);
  };

  const handleComposeFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setComposeUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/inbox-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          content: base64,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setComposeAttachments(prev => [...prev, data]);
      } else {
        const err = await response.json();
        alert('Upload failed: ' + (err.message || err.error));
      }
    } catch (err) {
      alert('Upload failed');
    } finally {
      setComposeUploading(false);
      if (composeFileInputRef.current) composeFileInputRef.current.value = '';
    }
  };

  const handleSendCompose = async () => {
    // Client-side validation
    if (!composeTo.trim()) {
      setComposeResult({ type: 'error', message: 'Email address is required' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(composeTo.trim())) {
      setComposeResult({ type: 'error', message: 'Invalid email address format' });
      return;
    }
    if (!composeSubject.trim()) {
      setComposeResult({ type: 'error', message: 'Subject is required' });
      return;
    }
    if (!composeBody.trim() && composeAttachments.length === 0) {
      setComposeResult({ type: 'error', message: 'Email body is required' });
      return;
    }

    setComposeSending(true);
    setComposeResult(null);
    try {
      const bodyHtml = `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6;">${composeBody.replace(/\n/g, '<br>')}</div>`;

      const response = await fetch('/api/inbox-compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: composeTo.trim(),
          subject: composeSubject.trim(),
          bodyHtml,
          bodyText: composeBody.trim(),
          from: composeFrom,
          attachments: composeAttachments.map(a => ({
            filename: a.filename,
            content: a.content,
            storageUrl: a.storageUrl,
          })),
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setComposeResult({ type: 'success', message: 'Email sent!' });
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
        setComposeAttachments([]);
      } else {
        setComposeResult({ type: 'error', message: data.message || data.error || 'Failed to send' });
      }
    } catch (err) {
      setComposeResult({ type: 'error', message: 'Network error' });
    } finally {
      setComposeSending(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const formatFullDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  };

  const extractName = (from) => {
    if (!from) return 'Unknown';
    const match = from.match(/^([^<]+)/);
    return match ? match[1].trim() : from;
  };

  return (
    <AdminShell environment={environment}>
      <Head>
        <title>FoodtoIndia Admin - Inbox{unreadCount > 0 ? ` (${unreadCount})` : ''}</title>
      </Head>

      <PageHeader
        icon={TrayArrowDown}
        title="Inbox"
        subtitle={
          unreadCount > 0
            ? `${unreadCount} unread`
            : 'All caught up'
        }
      />

      {/* Split Pane Layout */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: '0', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden', height: isMobile ? 'auto' : 'calc(100vh - 140px)' }}>

        {/* Email List Pane */}
        <div style={{
          width: isMobile ? '100%' : '340px',
          minWidth: isMobile ? '0' : '340px',
          borderRight: isMobile ? 'none' : '1px solid #ddd',
          overflowY: 'auto',
          backgroundColor: '#fff',
          display: isMobile && mobileShowDetail ? 'none' : 'block',
          ...(isMobile ? { maxHeight: '70vh' } : {}),
        }}>
          {/* Compose Button */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #ddd' }}>
            <button
              onClick={startCompose}
              style={{
                width: '100%',
                padding: '8px 16px',
                fontSize: '13px',
                backgroundColor: composing ? '#eceafb' : '#3f3ccc',
                color: composing ? '#3f3ccc' : 'white',
                border: composing ? '1px solid #3f3ccc' : 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontWeight: '500',
              }}
            >
              + New Email
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8c93a0' }}>Loading...</div>
          ) : emails.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#8c93a0' }}>
              <p style={{ fontSize: '16px', marginBottom: '8px' }}>No emails yet</p>
              <p style={{ fontSize: '13px' }}>Inbound emails will appear here</p>
            </div>
          ) : (
            <>
              {emails.map(email => (
                <div
                  key={email.id}
                  onClick={() => { setSelectedId(email.id); setComposing(false); if (isMobile) setMobileShowDetail(true); }}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid #eee',
                    cursor: 'pointer',
                    backgroundColor: selectedId === email.id ? '#eceafb' : email.read ? '#fff' : '#f0f7ff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{
                      fontSize: '13px',
                      fontWeight: email.read ? '400' : '600',
                      color: '#0b0e14',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: '200px',
                    }}>
                      {extractName(email.from)}
                    </span>
                    <span style={{ fontSize: '11px', color: '#8c93a0', flexShrink: 0 }}>
                      {formatDate(email.receivedAt)}
                    </span>
                  </div>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: email.read ? '400' : '600',
                    color: '#0b0e14',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {email.subject || '(no subject)'}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    {email.hasAttachments && (
                      <span style={{ fontSize: '11px', color: '#8c93a0' }}>📎</span>
                    )}
                    {email.replyCount > 0 && (
                      <span style={{ fontSize: '11px', color: '#8c93a0' }}>↩ {email.replyCount}</span>
                    )}
                  </div>
                </div>
              ))}
              {nextCursor && (
                <div style={{ padding: '12px', textAlign: 'center' }}>
                  <button
                    onClick={() => fetchEmails(nextCursor)}
                    disabled={loadingMore}
                    style={{
                      padding: '6px 16px',
                      fontSize: '13px',
                      backgroundColor: '#f7f8f9',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: loadingMore ? 'not-allowed' : 'pointer',
                      color: '#636a78',
                    }}
                  >
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Email Detail Pane */}
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#f7f8f9', display: isMobile && !mobileShowDetail ? 'none' : 'block', width: isMobile ? '100%' : undefined }}>
          {isMobile && mobileShowDetail && (
            <button
              onClick={() => { setMobileShowDetail(false); }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '14px',
                color: '#3f3ccc',
                cursor: 'pointer',
                padding: '8px 0',
                marginBottom: '8px',
                fontWeight: '500',
                marginLeft: '16px',
                marginTop: '8px',
              }}
            >
              &larr; Back to inbox
            </button>
          )}
          {composing ? (
            <div style={{ padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ margin: 0, fontSize: '20px', color: '#0b0e14' }}>New Email</h2>
                <button
                  onClick={cancelCompose}
                  style={{
                    padding: '6px 14px',
                    fontSize: '13px',
                    backgroundColor: '#f7f8f9',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: '#444b57',
                  }}
                >
                  Cancel
                </button>
              </div>

              <div style={{
                backgroundColor: '#fff',
                border: '1px solid #ddd',
                borderRadius: '6px',
                padding: '16px',
              }}>
                {/* From field */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#444b57', marginBottom: '4px' }}>From</label>
                  <select
                    value={composeFrom}
                    onChange={(e) => setComposeFrom(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      fontSize: '14px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      backgroundColor: '#fff',
                      color: '#0b0e14',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="support@foodtoindia.com">FoodtoIndia Support &lt;support@foodtoindia.com&gt;</option>
                    <option value="hello@foodtoindia.com">FoodtoIndia &lt;hello@foodtoindia.com&gt;</option>
                    <option value="santhosh@foodtoindia.com">Santhosh - FoodtoIndia &lt;santhosh@foodtoindia.com&gt;</option>
                  </select>
                </div>

                {/* To field */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#444b57', marginBottom: '4px' }}>To</label>
                  <input
                    type="email"
                    value={composeTo}
                    onChange={(e) => { setComposeTo(e.target.value); setComposeResult(null); }}
                    placeholder="recipient@example.com"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      fontSize: '14px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontFamily: 'Arial, sans-serif',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Subject field */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#444b57', marginBottom: '4px' }}>Subject</label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => { setComposeSubject(e.target.value); setComposeResult(null); }}
                    placeholder="Email subject"
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      fontSize: '14px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontFamily: 'Arial, sans-serif',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Body field */}
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#444b57', marginBottom: '4px' }}>Body</label>
                  <textarea
                    value={composeBody}
                    onChange={(e) => { setComposeBody(e.target.value); setComposeResult(null); }}
                    placeholder="Type your message..."
                    style={{
                      width: '100%',
                      minHeight: '200px',
                      padding: '10px',
                      fontSize: '14px',
                      lineHeight: '1.6',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      resize: 'vertical',
                      fontFamily: 'Arial, sans-serif',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                {/* Compose Attachment pills */}
                {composeAttachments.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
                    {composeAttachments.map((att, i) => (
                      <span key={i} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor: '#eceafb',
                        borderRadius: '12px',
                        color: '#0b0e14',
                      }}>
                        📎 {att.filename}
                        <button
                          onClick={() => setComposeAttachments(prev => prev.filter((_, j) => j !== i))}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#8c93a0',
                            cursor: 'pointer',
                            padding: '0 2px',
                            fontSize: '14px',
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="file"
                    accept="image/*"
                    ref={composeFileInputRef}
                    onChange={handleComposeFileSelect}
                    style={{ display: 'none' }}
                  />
                  <button
                    onClick={() => composeFileInputRef.current?.click()}
                    disabled={composeUploading}
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      backgroundColor: '#f7f8f9',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: composeUploading ? 'not-allowed' : 'pointer',
                      color: '#444b57',
                    }}
                  >
                    {composeUploading ? 'Uploading...' : 'Attach Image'}
                  </button>
                  <button
                    onClick={handleSendCompose}
                    disabled={composeSending}
                    style={{
                      padding: '8px 20px',
                      fontSize: '13px',
                      backgroundColor: composeSending ? '#636a78' : '#3f3ccc',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: composeSending ? 'not-allowed' : 'pointer',
                      fontWeight: '500',
                    }}
                  >
                    {composeSending ? 'Sending...' : 'Send Email'}
                  </button>
                  {composeResult && (
                    <span style={{
                      fontSize: '13px',
                      color: composeResult.type === 'success' ? '#0f7a52' : '#b42318',
                      fontWeight: '500',
                    }}>
                      {composeResult.message}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : !selectedId ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8c93a0' }}>
              <p>Select an email to read</p>
            </div>
          ) : loadingEmail ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8c93a0' }}>
              <p>Loading...</p>
            </div>
          ) : selectedEmail ? (
            <div style={{ padding: '24px' }}>
              {/* Email Header */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                  <h2 style={{ margin: 0, fontSize: '20px', color: '#0b0e14', flex: 1 }}>
                    {selectedEmail.subject || '(no subject)'}
                  </h2>
                  <div style={{ display: 'flex', gap: '8px', flexShrink: 0, marginLeft: '12px' }}>
                    <button
                      onClick={handleMarkUnread}
                      disabled={markingUnread || !selectedEmail?.read}
                      title={selectedEmail?.read ? 'Mark as unread' : 'Already unread'}
                      style={{
                        padding: '6px 14px',
                        fontSize: '13px',
                        backgroundColor: '#fff',
                        color: selectedEmail?.read ? '#444b57' : '#aaa',
                        border: `1px solid ${selectedEmail?.read ? '#d0d5dd' : '#e4e7ec'}`,
                        borderRadius: '4px',
                        cursor: markingUnread || !selectedEmail?.read ? 'not-allowed' : 'pointer',
                        fontWeight: '500',
                      }}
                    >
                      {markingUnread ? 'Marking…' : 'Mark unread'}
                    </button>
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      title="Delete email"
                      style={{
                        padding: '6px 14px',
                        fontSize: '13px',
                        backgroundColor: '#fff',
                        color: '#b42318',
                        border: '1px solid #b42318',
                        borderRadius: '4px',
                        cursor: deleting ? 'not-allowed' : 'pointer',
                        fontWeight: '500',
                      }}
                    >
                      {deleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: '14px', color: '#444b57', lineHeight: '1.8' }}>
                  <div><strong>From:</strong> {selectedEmail.from}</div>
                  <div><strong>To:</strong> {Array.isArray(selectedEmail.to) ? selectedEmail.to.join(', ') : selectedEmail.to}</div>
                  <div><strong>Date:</strong> {formatFullDate(selectedEmail.receivedAt)}</div>
                </div>
              </div>

              {/* Email Body */}
              <div style={{
                backgroundColor: '#fff',
                border: '1px solid #ddd',
                borderRadius: '6px',
                marginBottom: '20px',
                overflow: 'hidden',
              }}>
                {selectedEmail.html ? (
                  <iframe
                    srcDoc={selectedEmail.html}
                    sandbox="allow-same-origin"
                    style={{
                      width: '100%',
                      minHeight: '300px',
                      border: 'none',
                    }}
                    onLoad={(e) => {
                      // Auto-resize iframe to fit content
                      try {
                        const h = e.target.contentDocument.documentElement.scrollHeight;
                        e.target.style.height = Math.min(h + 20, 600) + 'px';
                      } catch (err) {
                        // Cross-origin restriction, use default height
                      }
                    }}
                  />
                ) : (
                  <pre style={{
                    padding: '16px',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    fontFamily: 'Arial, sans-serif',
                  }}>
                    {selectedEmail.text || '(empty)'}
                  </pre>
                )}
              </div>

              {/* Inbound Attachments */}
              {selectedEmail.attachments && selectedEmail.attachments.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#444b57' }}>Attachments</h4>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {selectedEmail.attachments.map((att, i) => (
                      <a
                        key={i}
                        href={att.storageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '6px 12px',
                          fontSize: '13px',
                          backgroundColor: '#f0f0f0',
                          borderRadius: '4px',
                          textDecoration: 'none',
                          color: '#3f3ccc',
                          border: '1px solid #ddd',
                        }}
                      >
                        📎 {att.filename}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Previous Replies */}
              {selectedEmail.replies && selectedEmail.replies.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#444b57' }}>
                    Previous Replies ({selectedEmail.replies.length})
                  </h4>
                  {selectedEmail.replies.map((reply, i) => (
                    <div key={i} style={{
                      backgroundColor: '#f0f7ff',
                      border: '1px solid #cce0ff',
                      borderRadius: '6px',
                      padding: '12px 16px',
                      marginBottom: '8px',
                    }}>
                      <div style={{ fontSize: '12px', color: '#636a78', marginBottom: '8px' }}>
                        <strong>{reply.from}</strong> → {reply.to} · {formatFullDate(reply.repliedAt)}
                      </div>
                      <iframe
                        srcDoc={reply.html}
                        sandbox="allow-same-origin"
                        style={{
                          width: '100%',
                          minHeight: '60px',
                          border: 'none',
                          backgroundColor: 'transparent',
                        }}
                        onLoad={(e) => {
                          try {
                            const h = e.target.contentDocument.documentElement.scrollHeight;
                            e.target.style.height = Math.min(h + 10, 300) + 'px';
                          } catch (err) {}
                        }}
                      />
                      {reply.attachments && reply.attachments.length > 0 && (
                        <div style={{ marginTop: '8px', display: 'flex', gap: '6px' }}>
                          {reply.attachments.map((att, j) => (
                            <a key={j} href={att.storageUrl} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: '12px', color: '#3f3ccc' }}>
                              📎 {att.filename}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Reply Composer */}
              <div style={{
                backgroundColor: '#fff',
                border: '1px solid #ddd',
                borderRadius: '6px',
                padding: '16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', color: '#444b57' }}>Reply</h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '13px', color: '#777' }}>from:</span>
                    <select
                      value={replyFrom}
                      onChange={(e) => setReplyFrom(e.target.value)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '13px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        backgroundColor: '#fff',
                        color: '#0b0e14',
                      }}
                    >
                      <option value="support@foodtoindia.com">support@foodtoindia.com</option>
                      <option value="hello@foodtoindia.com">hello@foodtoindia.com</option>
                      <option value="santhosh@foodtoindia.com">santhosh@foodtoindia.com</option>
                    </select>
                  </div>
                </div>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Type your reply..."
                  style={{
                    width: '100%',
                    minHeight: '120px',
                    padding: '10px',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    border: '1px solid #ddd',
                    borderRadius: '4px',
                    resize: 'vertical',
                    fontFamily: 'Arial, sans-serif',
                    boxSizing: 'border-box',
                  }}
                />

                {/* Attachment pills */}
                {attachments.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {attachments.map((att, i) => (
                      <span key={i} style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 10px',
                        fontSize: '12px',
                        backgroundColor: '#eceafb',
                        borderRadius: '12px',
                        color: '#0b0e14',
                      }}>
                        📎 {att.filename}
                        <button
                          onClick={() => removeAttachment(i)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#8c93a0',
                            cursor: 'pointer',
                            padding: '0 2px',
                            fontSize: '14px',
                            lineHeight: 1,
                          }}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center' }}>
                  <input
                    type="file"
                    accept="image/*"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      backgroundColor: '#f7f8f9',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      cursor: uploading ? 'not-allowed' : 'pointer',
                      color: '#444b57',
                    }}
                  >
                    {uploading ? 'Uploading...' : 'Attach Image'}
                  </button>
                  <button
                    onClick={handleSendReply}
                    disabled={sending || (!replyText.trim() && attachments.length === 0)}
                    style={{
                      padding: '8px 20px',
                      fontSize: '13px',
                      backgroundColor: sending ? '#636a78' : '#3f3ccc',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: sending || (!replyText.trim() && attachments.length === 0) ? 'not-allowed' : 'pointer',
                      fontWeight: '500',
                    }}
                  >
                    {sending ? 'Sending...' : 'Send Reply'}
                  </button>
                  {sendResult && (
                    <span style={{
                      fontSize: '13px',
                      color: sendResult.type === 'success' ? '#0f7a52' : '#b42318',
                      fontWeight: '500',
                    }}>
                      {sendResult.message}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AdminShell>
  );
}

export const getServerSideProps = withAuth();
