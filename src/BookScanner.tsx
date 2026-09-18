import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { BookOpen, Camera, Upload, Trash2 } from 'lucide-react';
import { api, image } from './cloud';

type Row = { key: string; name: string; village: string; amount: string; warning: string; state: 'pending' | 'saved' | 'unknown' };
type RecordInfo = { name: string; village: string; amount: number };
const money = (v: number) => 'Rp' + v.toLocaleString('id-ID');
const inputClass = 'w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base disabled:bg-slate-100';
const buttonClass = 'rounded-xl border px-4 py-3 font-semibold disabled:opacity-40';

export default function BookScanner({ records, onSaved }: { records: RecordInfo[]; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [photo, setPhoto] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const lock = useRef(false);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    if (busy || rows.some(r => r.state !== 'saved')) window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [busy, rows]);

  async function scan(selected: File) {
    if (lock.current) return;
    if (!selected.type.startsWith('image/')) { setMessage('Pilih file foto JPG, PNG, atau WebP.'); return; }
    if (selected.size > 30_000_000) { setMessage('Foto terlalu besar. Pilih foto di bawah 30 MB.'); return; }
    if (rows.some(r => r.state !== 'saved') && !window.confirm('Ganti hasil scan yang belum selesai?')) return;
    lock.current = true;
    setBusy(true); setRows([]); setReviewed(false); setWarning('');
    setFile(selected); setPhoto(URL.createObjectURL(selected));
    setMessage('Membaca halaman buku…');
    try {
      const prepared = await image.resizeIfNeeded(selected, { maxDimension: 1600, maxPixels: 2_000_000, quality: 0.9, mimeType: 'image/jpeg' });
      const response = await api.post('/api/scan-book', { data: prepared.data, mimeType: prepared.mimeType });
      if (!Array.isArray(response.data.rows)) throw new Error('Hasil tidak valid');
      const results = response.data.rows as Array<{ name?: string; village?: string; amount?: number | null; warning?: string }>;
      setRows(results.map((r, i) => ({ key: String(i), name: r.name ?? '', village: r.village ?? '', amount: r.amount == null ? '' : String(r.amount), warning: r.warning ?? '', state: 'pending' })));
      setWarning(response.data.warning ?? '');
      setMessage(results.length ? `${results.length} baris terbaca. Cocokkan SEMUA baris dan jumlah orang dengan foto sebelum menyimpan.` : 'Tidak ada baris terbaca. Foto lebih dekat dan pastikan halaman tidak terpotong.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Foto gagal diproses. Coba lagi.');
    } finally { lock.current = false; setBusy(false); }
  }
  function pick(e: ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]; e.target.value = '';
    if (selected) void scan(selected);
  }
  function edit(key: string, field: 'name' | 'village' | 'amount', value: string) {
    setRows(current => current.map(r => r.key === key ? { ...r, [field]: value } : r));
    setReviewed(false);
  }
  const pending = rows.filter(r => r.state === 'pending');
  const invalid = pending.some(r => !r.name.trim() || !r.village.trim() || !Number.isSafeInteger(Number(r.amount)) || Number(r.amount) <= 0);
  const total = pending.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const normalize = (v: string) => v.trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
  function same(a: RecordInfo, b: Row) {
    return normalize(a.name) === normalize(b.name) && normalize(a.village) === normalize(b.village) && a.amount === Number(b.amount);
  }
  async function saveAll() {
    if (lock.current || invalid || !reviewed || !pending.length) return;
    lock.current = true; setBusy(true);
    const keys = new Set(pending.map(r => r.key));
    setMessage(`Menyimpan ${pending.length} baris…`);
    try {
      const response = await api.post('/api/book-records', { rows: pending.map(r => ({ name: r.name.trim(), village: r.village.trim(), amount: Number(r.amount) })) });
      const ids: unknown = response.data.ids;
      if (!Array.isArray(ids) || ids.length !== pending.length || ids.some(id => id !== null && typeof id !== 'string')) throw new Error('Status simpan tidak lengkap');
      const states = new Map(pending.map((r, i) => [r.key, ids[i] ? 'saved' as const : 'pending' as const]));
      setRows(current => current.map(r => states.has(r.key) ? { ...r, state: states.get(r.key)! } : r));
      const count = ids.filter(Boolean).length;
      setMessage(`${count} baris berhasil disimpan. ${count < pending.length ? 'Baris yang gagal tetap bisa dikoreksi dan disimpan lagi.' : 'Semua hasil halaman ini sudah tersimpan.'}`);
    } catch {
      setRows(current => current.map(r => keys.has(r.key) ? { ...r, state: 'unknown' } : r));
      setMessage('Status penyimpanan belum pasti karena koneksi/server bermasalah. Periksa daftar catatan sebelum memasukkan ulang agar tidak ganda. Baris ini dikunci sementara.');
    } finally {
      setReviewed(false);
      try { await onSaved(); } finally { lock.current = false; setBusy(false); }
    }
  }
  return <section className='rounded-2xl bg-white p-5 shadow-sm'>
    <button type='button' className='flex w-full items-center gap-3 text-left text-xl font-semibold' onClick={() => setOpen(!open)} aria-expanded={open}>
      <BookOpen size={22} /> Scan Buku <span className='ml-auto text-sm text-slate-500'>{open ? 'Tutup panel' : 'Buka'}</span>
    </button>
    {open && <div className='mt-4 space-y-4'>
      <p className='text-slate-600'>Foto satu halaman berisi nama, desa/alamat, dan nominal. Setelah terbaca, periksa setiap baris lalu simpan. Tulisan kecil atau rapat sebaiknya difoto per bagian.</p>
      <div className='flex flex-wrap gap-2'>
        <button type='button' disabled={busy} className={buttonClass} onClick={() => camera.current?.click()}><Camera className='mr-2 inline' size={18} />Foto Buku</button>
        <button type='button' disabled={busy} className={buttonClass} onClick={() => gallery.current?.click()}><Upload className='mr-2 inline' size={18} />Pilih Foto Buku</button>
        {file && rows.length === 0 && <button type='button' disabled={busy} className={buttonClass} onClick={() => void scan(file)}>Coba Lagi</button>}
      </div>
      <input ref={camera} type='file' accept='image/*' capture='environment' className='hidden' aria-label='Foto buku dari kamera' onChange={pick} />
      <input ref={gallery} type='file' accept='image/*' className='hidden' aria-label='Pilih foto buku dari galeri' onChange={pick} />
      {photo && <details className='rounded-xl border p-3' open><summary className='cursor-pointer font-semibold'>Foto halaman — cocokkan dengan hasil</summary><img src={photo} alt='Halaman buku yang dipindai' className='mx-auto mt-3 max-h-[500px] max-w-full object-contain' /></details>}
      {message && <p role='status' aria-live='polite' className='rounded-xl bg-blue-50 p-3 text-blue-900'>{message}</p>}
      {warning && <p className='whitespace-pre-wrap rounded-xl bg-amber-50 p-3 text-amber-900'>{warning}</p>}
      {rows.length > 0 && <>
        <h3 className='font-semibold'>Hasil scan · {rows.length} baris</h3>
        <div className='space-y-3'>
          {rows.map((row, index) => {
            const duplicate = records.some(r => same(r, row)) || rows.some(r => r.key !== row.key && same({ ...r, amount: Number(r.amount) }, row));
            const disabled = busy || row.state !== 'pending';
            return <article key={row.key} className='min-w-0 space-y-3 rounded-xl border border-slate-200 p-3'>
              <div className='flex items-center justify-between gap-2'><span className='font-semibold'>Baris {index + 1} {row.state === 'saved' ? '· Tersimpan' : row.state === 'unknown' ? '· Periksa daftar catatan' : ''}</span>
                <button type='button' disabled={busy || row.state !== 'pending'} aria-label={`Buang baris ${index + 1}`} className='rounded-lg p-2 text-red-700 disabled:opacity-30' onClick={() => { setRows(current => current.filter(r => r.key !== row.key)); setReviewed(false); }}><Trash2 size={18} /></button></div>
              <div className='grid min-w-0 gap-3 md:grid-cols-3'>
                <label className='min-w-0 text-sm'>Nama<textarea rows={2} maxLength={2000} className={inputClass} disabled={disabled} value={row.name} onChange={e => edit(row.key, 'name', e.target.value)} /></label>
                <label className='min-w-0 text-sm'>Desa / alamat lengkap<textarea rows={2} maxLength={4000} className={inputClass} disabled={disabled} value={row.village} onChange={e => edit(row.key, 'village', e.target.value)} /></label>
                <label className='min-w-0 text-sm'>Nominal<input inputMode='numeric' placeholder='Rp0' className={inputClass} disabled={disabled} value={row.amount ? money(Number(row.amount)) : ''} onChange={e => edit(row.key, 'amount', e.target.value.replace(/\D/g, '').slice(0, 12))} /></label>
              </div>
              {row.warning && <p className='text-sm text-amber-800'>{row.warning}</p>}
              {duplicate && row.state === 'pending' && <p className='text-sm text-amber-800'>Ada nama, alamat, dan nominal yang sama. Periksa kemungkinan duplikat; buang baris ini jika sudah tercatat.</p>}
            </article>;
          })}
        </div>
        {pending.length > 0 && <div className='space-y-3 border-t pt-4'>
          <p className='font-semibold'>{pending.length} baris belum disimpan · Total {money(total)}</p>
          {invalid && <p className='text-red-700'>Lengkapi nama, desa/alamat, dan nominal positif pada semua baris yang belum disimpan.</p>}
          <label className='flex items-start gap-3'><input type='checkbox' className='mt-1 h-5 w-5 shrink-0' checked={reviewed} disabled={busy} onChange={e => setReviewed(e.target.checked)} /><span>Saya sudah mencocokkan semua baris, nominal, dan kemungkinan duplikat dengan buku.</span></label>
          <button type='button' className='rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:opacity-40' disabled={busy || invalid || !reviewed} onClick={() => void saveAll()}>Simpan Semua</button>
        </div>}
      </>}
    </div>}
  </section>;
}
