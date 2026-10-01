import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Receipt, MapPin, Clock, Motorcycle, XCircle, Gift, Lock,
  Paperclip, File as FileIcon, X, DownloadSimple, CircleNotch,
} from '@phosphor-icons/react';

// Ops-only internal notes + audit trail, rendered as the last section of
// both order-detail modals. Typed notes are append-only; status events
// (Order placed, Address confirmed, Dispatched, ...) are synthesized
// server-side and interleaved into the same feed.
//
// Notes can carry attachments (screenshots, PDFs, sheets, zips). Files upload
// directly to private GCS via a signed URL (see /api/order-note-upload), then
// the note is saved referencing their storage paths. Images render inline;
// everything else is a download chip. All ops-only — never sent to customers.

const QUICK_CHIPS = [
  'Called, no answer',
  'Reschedule requested',
  'Cancel requested',
  'Address confirmed',
];

// Client-side mirror of lib/noteAttachments — kept small on purpose. The
// server re-validates everything; this is just for fast feedback.
const IMAGE_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
]);
// Subset that browsers can actually decode inline. HEIC/HEIF upload fine but
// don't render in Chrome/Firefox, so they get a download chip like other files.
const RENDERABLE_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const DOC_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
// accept attribute — extensions cover types some browsers report with an
// empty MIME (e.g. .heic, .csv) so the OS picker still offers them.
const ACCEPT = 'image/*,.pdf,.xlsx,.xls,.csv,.doc,.docx,.txt,.zip';

const EVENT_ICON = {
  placed: Receipt,
  address: MapPin,
  time: Clock,
  dispatch: Motorcycle,
  cancel: XCircle,
  credit: Gift,
};

function initials(name) {
  return (
    (name || '?')
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

function fmtTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let localSeq = 0;

export function InternalNotes({ userId, orderId, collection = 'orders' }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Pending (composer) attachments: { localId, filename, contentType, size,
  // status: 'uploading'|'done'|'error', storagePath?, previewUrl?, error? }
  const [pending, setPending] = useState([]);
  const fileInputRef = useRef(null);
  // Mirror of `pending` for reads that must not go through a state updater
  // (the file-picker's count check and the unmount cleanup).
  const pendingRef = useRef(pending);
  useEffect(() => { pendingRef.current = pending; }, [pending]);

  const load = useCallback(async () => {
    if (!userId || !orderId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ userId, orderId, collection });
      const res = await fetch(`/api/order-notes?${qs.toString()}`);
      if (!res.ok) throw new Error(`order-notes ${res.status}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (err) {
      console.error('Load internal notes failed:', err);
      setError('Could not load notes.');
    } finally {
      setLoading(false);
    }
  }, [userId, orderId, collection]);

  useEffect(() => {
    load();
  }, [load]);

  // Revoke any object URLs still held when the component unmounts.
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  const insertChip = (text) => {
    setDraft((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
  };

  const patchPending = (localId, patch) =>
    setPending((prev) => prev.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));

  // Upload one file directly to GCS: get a signed PUT URL, then PUT the bytes.
  const uploadOne = async (file, localId) => {
    try {
      const initRes = await fetch('/api/order-note-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId, orderId, collection,
          filename: file.name,
          contentType: file.type,
          size: file.size,
        }),
      });
      if (!initRes.ok) throw new Error(`upload-init ${initRes.status}`);
      const { uploadUrl, storagePath } = await initRes.json();

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`gcs-put ${putRes.status}`);

      patchPending(localId, { status: 'done', storagePath });
    } catch (err) {
      console.error('Attachment upload failed:', err);
      patchPending(localId, { status: 'error', error: 'Upload failed' });
    }
  };

  // Validate + build the accepted list OUTSIDE the state updater — the updater
  // must be pure (React may invoke it more than once), so uploads, alerts, and
  // id/objectURL creation happen here, not inside setPending.
  const onPickFiles = (e) => {
    const chosen = Array.from(e.target.files || []);
    e.target.value = ''; // allow re-picking the same file
    if (!chosen.length) return;

    const accepted = []; // { file, entry }
    const alerts = [];
    let count = pendingRef.current.length;
    for (const file of chosen) {
      if (count >= MAX_FILES) {
        alerts.push(`You can attach at most ${MAX_FILES} files per note.`);
        break;
      }
      const type = file.type || '';
      if (!IMAGE_MIME.has(type) && !DOC_MIME.has(type)) {
        alerts.push(`"${file.name}" is not an allowed file type.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        alerts.push(`"${file.name}" is larger than 10 MB.`);
        continue;
      }
      const localId = `l${++localSeq}`;
      const isImg = RENDERABLE_IMAGE_MIME.has(type);
      accepted.push({
        file,
        entry: {
          localId,
          filename: file.name,
          contentType: type,
          size: file.size,
          status: 'uploading',
          previewUrl: isImg ? URL.createObjectURL(file) : null,
        },
      });
      count += 1;
    }

    if (accepted.length) {
      setPending((prev) => [...prev, ...accepted.map((a) => a.entry)]);
      accepted.forEach((a) => uploadOne(a.file, a.entry.localId));
    }
    if (alerts.length) window.alert(alerts.join('\n'));
  };

  const removePending = (localId) => {
    setPending((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.localId !== localId);
    });
  };

  const uploading = pending.some((p) => p.status === 'uploading');
  const readyAttachments = pending.filter((p) => p.status === 'done');
  const canSubmit = (draft.trim() || readyAttachments.length > 0) && !uploading && !saving;

  const addNote = async () => {
    if (!canSubmit) return;
    // A failed upload is excluded from the note — make sure ops knows before
    // it silently disappears on save.
    const failed = pending.filter((p) => p.status === 'error');
    if (failed.length &&
      !window.confirm(`${failed.length} file(s) failed to upload and won't be attached. Save the note anyway?`)) {
      return;
    }
    setSaving(true);
    try {
      const attachments = readyAttachments.map((p) => ({
        storagePath: p.storagePath,
        filename: p.filename,
        contentType: p.contentType,
        size: p.size,
      }));
      const res = await fetch('/api/order-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, orderId, collection, text: draft.trim(), attachments }),
      });
      if (!res.ok) throw new Error(`order-notes ${res.status}`);
      pending.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
      setDraft('');
      setPending([]);
      await load();
    } catch (err) {
      console.error('Add internal note failed:', err);
      window.alert('Could not save the note — please try again.');
    } finally {
      setSaving(false);
    }
  };

  const removeAttachment = async (noteId, storagePath) => {
    try {
      const res = await fetch('/api/order-notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, orderId, collection, noteId, storagePath }),
      });
      if (!res.ok) throw new Error(`delete ${res.status}`);
      await load();
    } catch (err) {
      console.error('Remove attachment failed:', err);
      window.alert('Could not remove the attachment — please try again.');
    }
  };

  const noteCount = items.filter((i) => i.type === 'note').length;

  return (
    <div className="mt-5 border-t border-ink-100 pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-[14px] font-semibold text-ink-900">Internal Notes</h3>
        <span className="inline-flex items-center gap-1 rounded-[5px] bg-warn-weak px-2 py-[3px] text-[10px] font-semibold text-warn">
          <Lock className="h-3 w-3" weight="fill" />
          Ops only · not shown to customer
        </span>
      </div>

      {/* Composer */}
      <div className="mb-4">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => insertChip(chip)}
              className="rounded-full border border-ink-200 bg-ink-50 px-3 py-1.5 text-[12px] font-medium text-ink-600 transition-colors hover:border-ink-300 hover:bg-ink-100 hover:text-ink-900"
            >
              {chip}
            </button>
          ))}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          placeholder="Add an internal note…"
          className="w-full resize-y rounded-[8px] border border-ink-200 bg-ink-0 px-3 py-2.5 text-[13.5px] text-ink-900 placeholder:text-ink-400 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />

        {/* Pending attachment previews */}
        {pending.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <PendingChip key={p.localId} item={p} onRemove={() => removePending(p.localId)} />
            ))}
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            onChange={onPickFiles}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={pending.length >= MAX_FILES}
            className="inline-flex items-center gap-1.5 rounded-[7px] border border-ink-200 bg-ink-0 px-3 py-2 text-[12.5px] font-medium text-ink-600 transition-colors hover:border-ink-300 hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" weight="regular" />
            Attach files
          </button>
          <button
            type="button"
            onClick={addNote}
            disabled={!canSubmit}
            className="rounded-[7px] bg-ink-900 px-4 py-2 text-[13px] font-semibold text-ink-0 transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:bg-ink-200"
          >
            {saving ? 'Saving…' : uploading ? 'Uploading…' : 'Add note'}
          </button>
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div className="py-3 text-[13px] text-ink-500">Loading…</div>
      ) : error ? (
        <div className="py-3 text-[13px] text-danger">{error}</div>
      ) : items.length === 0 ? (
        <div className="border-t border-ink-100 py-3.5 text-[13px] italic text-ink-500">
          No internal notes yet.
        </div>
      ) : (
        <>
          {noteCount > 0 ? (
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-micro text-ink-500">
              {noteCount} {noteCount === 1 ? 'note' : 'notes'}
            </div>
          ) : null}
          <div>
            {items.map((it) =>
              it.type === 'note' ? (
                <NoteRow key={it.id} note={it} onRemoveAttachment={removeAttachment} />
              ) : (
                <EventRow key={`${it.kind}-${it.ts}`} event={it} />
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PendingChip({ item, onRemove }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const isError = item.status === 'error';
  const isUploading = item.status === 'uploading';
  return (
    <div className="relative">
      {item.previewUrl && !previewFailed ? (
        <div className="h-16 w-16 overflow-hidden rounded-[7px] border border-ink-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.previewUrl}
            alt={item.filename}
            onError={() => setPreviewFailed(true)}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex h-16 w-24 flex-col justify-center rounded-[7px] border border-ink-200 bg-ink-50 px-2">
          <FileIcon className="h-4 w-4 text-ink-500" weight="regular" />
          <span className="mt-0.5 truncate text-[10px] text-ink-600" title={item.filename}>
            {item.filename}
          </span>
        </div>
      )}
      {/* Status overlay */}
      {isUploading ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-[7px] bg-ink-900/40">
          <CircleNotch className="h-5 w-5 animate-spin text-ink-0" weight="bold" />
        </div>
      ) : null}
      {isError ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-[7px] bg-danger/70 text-[9px] font-semibold text-ink-0">
          Failed
        </div>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.filename}`}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-ink-0 shadow-sm hover:bg-ink-700"
      >
        <X className="h-3 w-3" weight="bold" />
      </button>
    </div>
  );
}

function AttachmentView({ attachment, onRemove }) {
  const { url, filename, size, isImage: img } = attachment;
  const [imgFailed, setImgFailed] = useState(false);
  const unavailable = !url;

  if (img && !imgFailed) {
    return (
      <div className="group relative">
        {unavailable ? (
          <div className="flex h-20 w-20 items-center justify-center rounded-[7px] border border-ink-200 bg-ink-50 text-[10px] text-ink-400">
            unavailable
          </div>
        ) : (
          <a href={url} target="_blank" rel="noopener noreferrer" title={filename}>
            <div className="h-20 w-20 overflow-hidden rounded-[7px] border border-ink-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={filename}
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            </div>
          </a>
        )}
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${filename}`}
            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-ink-0 opacity-0 shadow-sm transition-opacity hover:bg-ink-700 group-hover:opacity-100"
          >
            <X className="h-3 w-3" weight="bold" />
          </button>
        ) : null}
      </div>
    );
  }

  // Non-image: download chip.
  return (
    <div className="group relative inline-flex items-center gap-2 rounded-[7px] border border-ink-200 bg-ink-50 py-1.5 pl-2.5 pr-3">
      <FileIcon className="h-4 w-4 shrink-0 text-ink-500" weight="regular" />
      <div className="min-w-0">
        <div className="max-w-[180px] truncate text-[12.5px] font-medium text-ink-900" title={filename}>
          {filename}
        </div>
        {size ? <div className="text-[10.5px] text-ink-500">{fmtSize(size)}</div> : null}
      </div>
      {url ? (
        <a
          href={url}
          download={filename}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Download ${filename}`}
          className="ml-1 text-ink-500 hover:text-accent"
        >
          <DownloadSimple className="h-4 w-4" weight="regular" />
        </a>
      ) : (
        <span className="ml-1 text-[10px] text-ink-400">unavailable</span>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${filename}`}
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink-900 text-ink-0 opacity-0 shadow-sm transition-opacity hover:bg-ink-700 group-hover:opacity-100"
        >
          <X className="h-3 w-3" weight="bold" />
        </button>
      ) : null}
    </div>
  );
}

function NoteRow({ note, onRemoveAttachment }) {
  const attachments = Array.isArray(note.attachments) ? note.attachments : [];
  return (
    <div className="flex gap-3 border-t border-ink-100 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-weak text-[11px] font-bold text-accent">
        {initials(note.authorName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
          <span className="text-[13px] font-semibold text-ink-900">{note.authorName}</span>
          <span className="font-mono text-[11px] text-ink-500">{fmtTime(note.ts)}</span>
        </div>
        {note.text ? (
          <div className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-900">
            {note.text}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-start gap-2">
            {attachments.map((a) => (
              <AttachmentView
                key={a.storagePath}
                attachment={a}
                onRemove={() => onRemoveAttachment(note.id, a.storagePath)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EventRow({ event }) {
  const Icon = EVENT_ICON[event.kind] || Clock;
  return (
    <div className="flex gap-3 border-t border-ink-100 py-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500">
        <Icon className="h-3.5 w-3.5" weight="regular" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[12.5px] font-semibold text-ink-600">{event.text}</span>
          <span className="font-mono text-[11px] text-ink-500">{fmtTime(event.ts)}</span>
        </div>
        {event.url ? (
          <a
            href={event.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 block break-all text-[12px] text-accent hover:underline"
          >
            Tracking: {event.url}
          </a>
        ) : null}
      </div>
    </div>
  );
}
