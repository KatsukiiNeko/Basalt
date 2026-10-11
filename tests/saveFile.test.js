// saveBlob's two paths: the Chromium destination picker, and the anchor
// download that src/utils/saveFile.js falls back to. jsdom has neither
// showSaveFilePicker nor URL.createObjectURL, so both paths are stubbed
// here and asserted directly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveBlob } from '../src/utils/saveFile';

const BLOB = new Blob(['x'], { type: 'application/octet-stream' });

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('saveBlob', () => {
  it('writes through showSaveFilePicker when available', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    const picker = vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({ write, close }),
    });
    vi.stubGlobal('showSaveFilePicker', picker);

    await expect(saveBlob(BLOB, 'Basalt_2026-10-10.xlsx')).resolves.toBe('saved');
    expect(picker).toHaveBeenCalledWith(
      expect.objectContaining({ suggestedName: 'Basalt_2026-10-10.xlsx' })
    );
    expect(write).toHaveBeenCalledWith(BLOB);
    expect(close).toHaveBeenCalled();
  });

  it('reports AbortError as cancelled without falling back', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(
      Object.assign(new Error('dismissed'), { name: 'AbortError' })
    ));
    const createObjectURL = vi.fn().mockReturnValue('blob:x');
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }));

    await expect(saveBlob(BLOB, 'a.xlsx')).resolves.toBe('cancelled');
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('falls back to an anchor download when the picker refuses', async () => {
    vi.stubGlobal('showSaveFilePicker', vi.fn().mockRejectedValue(
      Object.assign(new Error('no gesture'), { name: 'NotAllowedError' })
    ));
    const createObjectURL = vi.fn().mockReturnValue('blob:x');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(saveBlob(BLOB, 'a.json')).resolves.toBe('saved');
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('uses the anchor download when the API is missing entirely', async () => {
    expect(window.showSaveFilePicker).toBeUndefined();
    const createObjectURL = vi.fn().mockReturnValue('blob:x');
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await expect(saveBlob(BLOB, 'Basalt.xlsx')).resolves.toBe('saved');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });
});
