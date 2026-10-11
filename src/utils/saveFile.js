const MIME_BY_EXT = {
  '.xlsx': {
    description: 'Excel workbook',
    accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
  },
  '.json': {
    description: 'JSON',
    accept: { 'application/json': ['.json'] },
  },
};

function typesFor(filename) {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? undefined : [MIME_BY_EXT[filename.slice(dot)]].filter(Boolean);
}

function anchorDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Save a blob to disk. We try the File System API first (Chromium lets the
 * user pick where it lands) and fall back to an anchor download when the
 * browser has no showSaveFilePicker. Dashboard's handleExport calls this
 * while the export spinner is still up.
 *
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<'saved' | 'cancelled'>}
 */
export async function saveBlob(blob, filename) {
  if (typeof window.showSaveFilePicker !== 'function') {
    anchorDownload(blob, filename);
    return 'saved';
  }
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: typesFor(filename),
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return 'saved';
  } catch (err) {
    // The user dismissed the picker — that is a cancel, not a failure, so
    // we report it and write nothing.
    if (err && err.name === 'AbortError') return 'cancelled';
    // Everything else degrades to the plain anchor download: NotAllowedError
    // when a long export outlives Chrome's ~5s user-activation window, an
    // unsupported sandbox, a plain write failure. Better a file in Downloads
    // than a lost export.
    // ponytail: anchor fallback loses folder choice, revisit only if the
    // NotAllowedError path starts firing in practice.
    anchorDownload(blob, filename);
    return 'saved';
  }
}
