import React, { useId, useRef, useState } from 'react';
import Button from './Button';
import Icon from './Icon';

const VARIANTS = new Set(['files', 'paste']);

export default function Dropzone({
  variant = 'files',
  accept,
  multiple = false,
  disabled = false,
  empty = true,
  title,
  description,
  onFiles,
  onPasteText,
  className = '',
  ...props
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const safeVariant = VARIANTS.has(variant) ? variant : 'files';

  const publishFiles = (source) => {
    if (disabled) return;
    const files = Array.from(source || []);
    if (files.length) onFiles?.(multiple ? files : files.slice(0, 1));
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragOver(false);
    publishFiles(event.dataTransfer?.files);
  };

  const handlePaste = (event) => {
    if (disabled) return;
    const pastedFiles = Array.from(event.clipboardData?.files || []);
    if (pastedFiles.length) {
      publishFiles(pastedFiles);
      return;
    }
    const text = event.clipboardData?.getData('text/plain');
    if (text) onPasteText?.(text);
  };

  return (
    <section
      {...props}
      className={[
        'dropzone',
        `dropzone--${safeVariant}`,
        dragOver ? 'is-drag-over' : '',
        disabled ? 'is-disabled' : '',
        empty ? 'is-empty' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-disabled={disabled || undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragOver(false);
      }}
      onDrop={handleDrop}
      onPaste={safeVariant === 'paste' ? handlePaste : undefined}
    >
      <input
        ref={inputRef}
        id={inputId}
        className="dropzone__input"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        tabIndex={-1}
        onChange={(event) => {
          publishFiles(event.currentTarget.files);
          event.currentTarget.value = '';
        }}
      />
      <div className="dropzone__visual" aria-hidden="true">
        <Icon name={safeVariant === 'paste' ? 'copy' : 'upload'} size={28} />
      </div>
      <div className="dropzone__copy">
        <h3>{title || (safeVariant === 'paste' ? 'Paste or add a file' : 'Drop files here')}</h3>
        <p>
          {description || (safeVariant === 'paste'
            ? 'Paste from the clipboard, or choose a file from your device.'
            : 'Drag files into this area, or browse from your device.')}
        </p>
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        icon="plus"
        onClick={() => inputRef.current?.click()}
      >
        Browse files
      </Button>
    </section>
  );
}
