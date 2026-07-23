/**
 * Build hierarchical archive trees from flat entry name lists.
 */

/**
 * @param {Array<string|{name?:string,path?:string,entry?:string,size?:number}>} entries
 * @returns {{ name: string, path: string, size?: number|null, children: object[], isDir: boolean }}
 */
export function buildArchiveTree(entries = []) {
  const root = { name: '', path: '', isDir: true, children: [], size: null };

  const ensureDir = (parent, name, path) => {
    let node = parent.children.find((c) => c.name === name && c.isDir);
    if (!node) {
      node = { name, path, isDir: true, children: [], size: null };
      parent.children.push(node);
    }
    return node;
  };

  for (const raw of entries) {
    const name = typeof raw === 'string'
      ? raw
      : (raw?.name || raw?.path || raw?.entry || '');
    if (!name || name === '.' || name === './') continue;
    const size = typeof raw === 'object' && raw && raw.size != null ? Number(raw.size) : null;
    const parts = String(name).replace(/\\/g, '/').replace(/^\.?\//, '').split('/').filter(Boolean);
    if (!parts.length) continue;

    let cursor = root;
    let acc = '';
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      acc = acc ? `${acc}/${part}` : part;
      const isLast = i === parts.length - 1;
      const looksDir = !isLast || String(name).endsWith('/');
      if (looksDir) {
        cursor = ensureDir(cursor, part, acc);
      } else {
        const existing = cursor.children.find((c) => c.name === part && !c.isDir);
        if (existing) {
          if (size != null) existing.size = size;
        } else {
          cursor.children.push({
            name: part,
            path: acc,
            isDir: false,
            children: [],
            size: Number.isFinite(size) ? size : null,
          });
        }
      }
    }
  }

  sortTree(root);
  return root;
}

function sortTree(node) {
  node.children.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

/**
 * Flatten tree for search; returns matching nodes (files + dirs that match query).
 */
export function filterArchiveTree(root, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return root;

  const walk = (node) => {
    if (!node.isDir) {
      return node.path.toLowerCase().includes(q) || node.name.toLowerCase().includes(q)
        ? { ...node, children: [] }
        : null;
    }
    const kids = node.children.map(walk).filter(Boolean);
    const selfMatch = node.path && (node.path.toLowerCase().includes(q) || node.name.toLowerCase().includes(q));
    if (!kids.length && !selfMatch) return null;
    return { ...node, children: kids };
  };

  const filtered = walk(root);
  return filtered || { name: '', path: '', isDir: true, children: [], size: null };
}

export function countTreeNodes(node) {
  if (!node) return 0;
  let n = node.path ? 1 : 0;
  for (const c of node.children || []) n += countTreeNodes(c);
  return n;
}

export function flattenTree(node, out = [], limit = Infinity) {
  if (!node || out.length >= limit) return out;
  for (const c of node.children || []) {
    if (out.length >= limit) break;
    out.push(c);
    if (c.isDir) flattenTree(c, out, limit);
  }
  return out;
}
