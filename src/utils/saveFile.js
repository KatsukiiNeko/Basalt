// Saves a Blob to a destination the user picks.
//
// Chromium gets the File System Access API ("save as" dialog with folder
// choice, remembered per origin); everyone else — and any case where the
// picker is unavailable or refused — falls back to the classic anchor
// download into the browser's default downloads folder. Never rejects:
// callers only care about 'saved' vs 'cancelled'.

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
    // User dismissed the dialog: report it, write nothing.
    if (err && err.name === 'AbortError') return 'cancelled';
    // Anything else (NotAllowedError when a long export outlives Chrome's
    // ~5s user-activation window, unsupported sandbox, write failure) degrades
    // to the plain download — better a file in Downloads than a lost export.
    // ponytail: anchor fallback loses folder choice, revisit only if the
    // NotAllowedError path starts firing in practice.
    anchorDownload(blob, filename);
    return 'saved';
  }
}
