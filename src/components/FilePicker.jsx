import React, { useRef } from 'react';
import Icon from './Icon';
import { emptyIllustrations } from '../assets/registry';

/**
 * Real file picker + dropzone wired to local API uploads.
 */
export default function FilePicker({
  title = 'Drop files here',
  subtitle = 'Drag and drop or browse from your computer',
  accept,
  multiple = true,
  files = [],
  onChange,
  disabled = false,
}) {
  const inputRef = useRef(null);

  const handleFiles = (list) => {
    if (!list?.length) return;
    const next = multiple ? [...files, ...Array.from(list)] : [list[0]];
    onChange?.(next);
  };

  return (
    <div className="file-picker-block">
      <button
        className="file-dropzone"
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled) return;
          handleFiles(e.dataTransfer.files);
        }}
      >
        {!files.length ? (
          <img className="dropzone-empty-art" src={emptyIllustrations.upload} alt="" width="480" height="300" aria-hidden="true" />
        ) : (
          <div className="dropzone-icon"><Icon name="upload" size={25} /></div>
        )}
        <strong>{title}</strong>
        <span>{subtitle}</span>
        <small>{files.length ? `${files.length} file(s) selected` : 'Files stay on your machine and the local API'}</small>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {files.length > 0 ? (
        <div className="file-queue-list">
          {files.map((file, index) => (
            <div className="file-queue-row" key={`${file.name}-${index}`}>
              <div className="file-type-icon"><Icon name="file" size={18} /></div>
              <div className="file-info">
                <strong>{file.name}</strong>
                <span>{file.type || 'file'} • {formatBytes(file.size)}</span>
              </div>
              <button
                className="icon-button quiet"
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange?.(files.filter((_, i) => i !== index))}
              >
                <Icon name="trash" size={17} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatBytes(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
