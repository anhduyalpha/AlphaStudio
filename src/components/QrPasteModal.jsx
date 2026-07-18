import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';
import { PrimaryButton, SecondaryButton } from './Common';
import {
  formatBytes,
  imageBlobFromClipboardEvent,
  prepareClipboardImage,
} from '../lib/clipboardImage';

/**
 * Modal for pasting / dropping a QR image before decode.
 * Props: { open, onClose, onDecoded, notify, busy }
 */
export default function QrPasteModal({ open, onClose, onDecoded, notify, busy = false }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const fileInputRef = useRef(null);
  const previewUrlRef = useRef(null);

  const [phase, setPhase] = useState('idle'); // idle | hasImage | decoding | result | error
  const [errorMessage, setErrorMessage] = useState('');
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [meta, setMeta] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  const resetImage = useCallback(() => {
    revokePreview();
    setFile(null);
    setPreviewUrl(null);
    setMeta(null);
    setPhase('idle');
    setErrorMessage('');
  }, [revokePreview]);

  const resetAll = useCallback(() => {
    resetImage();
  }, [resetImage]);

  // Clear preview URL on close / unmount
  useEffect(() => {
    if (!open) {
      resetAll();
    }
  }, [open, resetAll]);

  useEffect(() => () => {
    revokePreview();
  }, [revokePreview]);

  // Sync decoding phase from parent busy flag after decode starts
  useEffect(() => {
    if (!open) return;
    if (busy && phase === 'decoding') return;
    if (busy && (phase === 'hasImage' || phase === 'decoding')) {
      setPhase('decoding');
    }
  }, [busy, open, phase]);

  const applyPrepared = useCallback((prepared) => {
    if (!prepared?.ok) {
      setPhase('error');
      setErrorMessage(prepared?.reason || 'Could not use this image.');
      notify?.(prepared?.reason || 'Invalid clipboard image');
      return;
    }
    revokePreview();
    previewUrlRef.current = prepared.previewUrl;
    setFile(prepared.file);
    setPreviewUrl(prepared.previewUrl);
    setMeta(prepared.meta);
    setPhase('hasImage');
    setErrorMessage('');
  }, [notify, revokePreview]);

  const ingestBlob = useCallback(async (blob) => {
    if (!blob) {
      setPhase('error');
      setErrorMessage('No image data found. Paste an image, drop a file, or choose one.');
      return;
    }
    try {
      const prepared = await prepareClipboardImage(blob);
      applyPrepared(prepared);
    } catch (err) {
      setPhase('error');
      setErrorMessage(err?.message || 'Could not read image.');
      notify?.(err?.message || 'Could not read image');
    }
  }, [applyPrepared, notify]);

  // Focus trap + Escape + paste while open
  useEffect(() => {
    if (!open) return undefined;

    const root = dialogRef.current;
    const previous = document.activeElement;

    const getFocusable = () => {
      if (!root) return [];
      return Array.from(
        root.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    };

    // Focus first focusable control
    requestAnimationFrame(() => {
      const list = getFocusable();
      list[0]?.focus();
    });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busy) onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !root) return;
      const list = getFocusable();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === first || !root.contains(document.activeElement)) {
          event.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !root.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    const onPaste = async (event) => {
      if (busy) return;
      try {
        let blob = null;
        const items = event.clipboardData?.items;
        if (items) {
          for (const item of items) {
            if (item.kind === 'file' && item.type.startsWith('image/')) {
              blob = item.getAsFile();
              if (blob) break;
            }
          }
        }
        if (blob) {
          event.preventDefault();
          await ingestBlob(blob);
        }
      } catch (err) {
        setPhase('error');
        setErrorMessage(err?.message || 'Paste failed.');
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('paste', onPaste);
      if (previous && typeof previous.focus === 'function') {
        try {
          previous.focus();
        } catch {
          /* ignore */
        }
      }
    };
  }, [open, onClose, busy, ingestBlob]);

  const readFromClipboardApi = async () => {
    if (busy) return;
    try {
      const blob = await imageBlobFromClipboardEvent(null);
      if (!blob) {
        setPhase('error');
        setErrorMessage('No image in clipboard. Copy an image, then try again or use Ctrl+V.');
        return;
      }
      await ingestBlob(blob);
    } catch (err) {
      const msg =
        err?.code === 'PERMISSION' || err?.name === 'NotAllowedError'
          ? 'Clipboard permission denied. Use Ctrl+V in this dialog, drag-and-drop, or choose a file.'
          : err?.message || 'Could not read clipboard.';
      setPhase('error');
      setErrorMessage(msg);
      notify?.(msg);
    }
  };

  const onFileInput = async (event) => {
    const list = event.target.files;
    const next = list?.[0];
    event.target.value = '';
    if (!next) return;
    if (!String(next.type || '').startsWith('image/')) {
      setPhase('error');
      setErrorMessage('Selected file is not an image. Choose a PNG, JPEG, or WebP.');
      return;
    }
    await ingestBlob(next);
  };

  const onDrop = async (event) => {
    event.preventDefault();
    setDragOver(false);
    if (busy) return;
    const next = event.dataTransfer?.files?.[0];
    if (!next) return;
    if (!String(next.type || '').startsWith('image/')) {
      setPhase('error');
      setErrorMessage('Dropped file is not an image. Drop a PNG, JPEG, or WebP.');
      return;
    }
    await ingestBlob(next);
  };

  const handleDecode = async () => {
    if (!file || busy) return;
    setPhase('decoding');
    setErrorMessage('');
    try {
      await onDecoded?.(file);
      setPhase('result');
      onClose?.();
    } catch (err) {
      setPhase('error');
      setErrorMessage(err?.message || 'Decode failed.');
    }
  };

  if (!open) return null;

  const isDecoding = phase === 'decoding' || busy;
  const hasImage = Boolean(file && previewUrl);

  return (
    <div className="modal-layer qr-paste-layer" role="presentation">
      <button
        className="modal-scrim"
        type="button"
        aria-label="Close paste dialog"
        onClick={() => {
          if (!busy) onClose?.();
        }}
      />
      <div
        ref={dialogRef}
        className="qr-paste-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="qr-paste-header">
          <div>
            <p className="eyebrow">QR Decode</p>
            <h3 id={titleId}>Paste image</h3>
          </div>
          <button
            type="button"
            className="icon-button quiet"
            aria-label="Close"
            onClick={() => {
              if (!busy) onClose?.();
            }}
            disabled={busy}
          >
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="qr-paste-body">
          {errorMessage ? (
            <div className="qr-paste-alert" role="alert">
              <Icon name="close" size={16} />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          {!hasImage ? (
            <div
              className={`qr-paste-dropzone${dragOver ? ' is-dragover' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={onDrop}
            >
              <div className="dropzone-icon" aria-hidden="true">
                <Icon name="image" size={28} />
              </div>
              <strong>Paste, drop, or choose a QR image</strong>
              <span>Ctrl+V / ⌘V while this dialog is open · PNG, JPEG, WebP</span>
              <div className="qr-paste-drop-actions">
                <SecondaryButton
                  icon="copy"
                  onClick={readFromClipboardApi}
                  disabled={isDecoding}
                  aria-label="Read image from clipboard"
                >
                  Read clipboard
                </SecondaryButton>
                <SecondaryButton
                  icon="upload"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isDecoding}
                  aria-label="Choose image file"
                >
                  Choose file
                </SecondaryButton>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={onFileInput}
              />
            </div>
          ) : (
            <div className="qr-paste-preview-block">
              <div className="qr-paste-preview-frame">
                <img src={previewUrl} alt="Clipboard image preview" />
              </div>
              <dl className="qr-paste-meta">
                <div>
                  <dt>Name</dt>
                  <dd>{meta?.name || file?.name || '—'}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{meta?.type || file?.type || '—'}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(meta?.size ?? file?.size)}</dd>
                </div>
                <div>
                  <dt>Dimensions</dt>
                  <dd>
                    {meta?.width && meta?.height ? `${meta.width} × ${meta.height}` : '—'}
                  </dd>
                </div>
              </dl>
              <div className="qr-paste-preview-actions">
                <SecondaryButton
                  icon="refresh"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isDecoding}
                  aria-label="Replace image"
                >
                  Replace
                </SecondaryButton>
                <SecondaryButton
                  icon="trash"
                  onClick={resetImage}
                  disabled={isDecoding}
                  aria-label="Remove image"
                >
                  Remove
                </SecondaryButton>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={onFileInput}
                />
              </div>
            </div>
          )}

          {isDecoding ? (
            <p className="qr-paste-status" role="status" aria-live="polite">
              Decoding QR…
            </p>
          ) : null}
        </div>

        <footer className="qr-paste-footer">
          <SecondaryButton
            onClick={() => {
              if (!busy) onClose?.();
            }}
            disabled={busy}
            aria-label="Cancel paste"
          >
            Cancel
          </SecondaryButton>
          <PrimaryButton
            icon="scan"
            onClick={handleDecode}
            disabled={!hasImage || isDecoding}
            aria-label="Decode pasted image"
          >
            {isDecoding ? 'Decoding…' : 'Decode'}
          </PrimaryButton>
        </footer>
      </div>
    </div>
  );
}
