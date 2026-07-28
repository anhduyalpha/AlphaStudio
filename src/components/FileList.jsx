import React from 'react';
import EmptyState from './EmptyState';
import FileRow from './FileRow';

export default function FileList({
  items,
  children,
  renderItem,
  label = 'Files',
  emptyTitle = 'No files yet',
  emptyDescription = 'Add a file to begin.',
  emptyAction,
  className = '',
}) {
  const rows = children ?? items?.map((item) => (
    renderItem
      ? <React.Fragment key={item.id}>{renderItem(item)}</React.Fragment>
      : <FileRow key={item.id} {...item} />
  ));
  const empty = !React.Children.count(rows);

  return (
    <section
      className={[
        'file-list',
        empty ? 'file-list--empty' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-label={label}
    >
      {empty ? (
        <EmptyState
          variant="compact"
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : rows}
    </section>
  );
}
