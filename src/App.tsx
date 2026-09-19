import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Download, Mail, MapPin, Mic, Pencil, Search, Trash2, Users } from 'lucide-react';
import { api, image } from './cloud';
import BookScanner from './BookScanner';
import { readImage, parseSingle } from './localOcr';

type Item = {
  id: string;
  name: string;
  village: string;
  amount: number;
  createdAt: string;
  updatedAt: string;
};

type VoiceResult = { name: string; village: string; amount: number | null };

const words: Record<string, number> = {
  nol: 0,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  seratus: 100,
  seribu: 1000,
};

function titleCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function parseIndonesianNumber(text: string): number | null {
  const cleaned = text
    .toLowerCase()
    .replace(/rp\.?/g, '')
    .replace(/(?<=\d)[.,](?=\d{3}(?:\D|$))/g, '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^\d+$/.test(cleaned)) return Number(cleaned);

  const tokens = cleaned.split(' ').filter(Boolean);
  let total = 0;
  let current = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      current += Number(token);
      continue;
    }
    if (token === 'juta') {
      total += (current || 1) * 1000000;
      current = 0;
      continue;
    }
    if (token === 'ribu') {
      total += (current || 1) * 1000;
      current = 0;
      continue;
    }
    if (token === 'ratus') {
      current = (current || 1) * 100;
      continue;
    }
    if (token === 'puluh') {
      current = (current || 1) * 10;
      continue;
    }
    if (token === 'belas') {
      current = (current || 1) + 10;
      continue;
    }
    if (words[token] !== undefined) current += words[token];
  }
  const result = total + current;
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function normalizeVillage(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function editDistance(a: string, b: string) {
  const x = normalizeVillage(a);
  const y = normalizeVillage(b);
  const dp = Array.from({ length: x.length + 1 }, () => Array(y.length + 1).fill(0));
  for (let i = 0; i <= x.length; i++) dp[i][0] = i;
  for (let j = 0; j <= y.length; j++) dp[0][j] = j;
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[x.length][y.length];
}

function villageSimilarity(a: string, b: string) {
  const x = normalizeVillage(a);
  const y = normalizeVillage(b);
  if (!x || !y) return 0;
  return 1 - editDistance(x, y) / Math.max(x.length, y.length);
}

function bestKnownVillage(candidate: string, knownVillages: string[]) {
  const cleanCandidate = candidate.trim();
  const exact = knownVillages.find(v => normalizeVillage(v) === normalizeVillage(cleanCandidate));
  if (exact) return exact;
  let best = cleanCandidate;
  let score = 0;
  for (const village of knownVillages) {
    const current = villageSimilarity(cleanCandidate, village);
    if (current > score) {
      score = current;
      best = village;
    }
  }
  // Kamus database + fuzzy matching: typo kecil memakai ejaan desa/alamat yang sudah tersimpan.
  return score >= 0.62 ? best : titleCase(cleanCandidate);
}

function parseVoice(text: string, knownVillages: string[] = []): VoiceResult {
  const normalized = text
    .toLowerCase()
    .replace(/(\d)[.,](?=\d{3}\b)/g, '$1')
    .replace(/[!?;,:]/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const amountMatch = normalized.match(
    /((?:\d+(?:\s+(?:ribu|juta))?(?:\s+\d+(?:\s+(?:ribu|juta))?)*)|(?:nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|belas|puluh|ratus|ribu|juta)(?:\s+(?:nol|satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|seribu|belas|puluh|ratus|ribu|juta))*)\s*$/
  );
  const amountText = amountMatch?.[1] ?? '';
  const amount = amountText ? parseIndonesianNumber(amountText) : null;
  const identity = (amountText
    ? normalized.slice(0, normalized.length - amountText.length)
    : normalized)
    .replace(/\b(?:rp|rupiah)\b\.?\s*$/i, '')
    .trim();
  const marker = identity.match(/^(.*?)\s+(?:(?:dari|asal)\s+)?desa\s+(.+)$/i);
  if (marker) {
    return {
      name: titleCase(marker[1]),
      village: bestKnownVillage(marker[2], knownVillages),
      amount,
    };
  }
  const identityWords = identity.split(/\s+/).filter(Boolean);
  if (identityWords.length < 2) {
    return {
      name: identityWords[0] ? titleCase(identityWords[0]) : '',
      village: '',
      amount,
    };
  }
  let bestMatch: { village: string; start: number; score: number } | null = null;
  for (let start = 1; start < identityWords.length; start++) {
    const candidate = identityWords.slice(start).join(' ');
    for (const village of knownVillages) {
      const score = villageSimilarity(candidate, village);
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { village, start, score };
      }
    }
  }
  if (bestMatch && bestMatch.score >= 0.62) {
    return {
      // Nama tidak pernah dikoreksi dengan kamus/fuzzy. Hanya alamat/desa yang dicocokkan.
      name: titleCase(identityWords.slice(0, bestMatch.start).join(' ')),
      village: bestMatch.village,
      amount,
    };
  }
  // Tanpa kecocokan alamat yang cukup kuat, jangan menebak atau mengubah nama.
  // Biarkan pengguna memeriksa hasil Speech Recognition apa adanya.
  return {
    name: titleCase(identity),
    village: '',
    amount,
  };
}

function rupiah(value: number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace('Rp', 'Rp');
}

function App() {
  const [records, setRecords] = useState<Item[]>([]);
  const [name, setName] = useState('');
  const [village, setVillage] = useState('');
  const [amount, setAmount] = useState('');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Item[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchRevision, setSearchRevision] = useState(0);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [scanDetail, setScanDetail] = useState('');
  const [scanning, setScanning] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const speechRecognitionRef = useRef<any>(null);

  async function load() {
    try {
      const allRecords = await getAllRecords();
      setRecords(allRecords);
      setPage(1);
      setSearchRevision(current => current + 1);
      setStatus('');
    } catch {
      setStatus('Data belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }

  async function getAllRecords() {
    const all: Item[] = [];
    let token: string | null = null;
    do {
      const res = await api.get(token ? `/api/records?${new URLSearchParams({ nextToken: token })}` : '/api/records');
      all.push(...((res.data.records ?? []) as Item[]));
      token = res.data.nextToken ?? null;
    } while (token);
    return all;
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const term = query.trim();
    setSearchError('');
    if (!term) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearchResults([]);
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = new Map<string, Item>();
        const seenTokens = new Set<string>();
        let token: string | null = null;
        do {
          const params = new URLSearchParams({ q: term });
          if (token) params.set('nextToken', token);
          const res = await api.get(`/api/search?${params.toString()}`);
          if (cancelled) return;
          for (const item of (res.data.records ?? []) as Item[]) {
            found.set(item.id, item);
          }
          token = res.data.nextToken ?? null;
          if (token && seenTokens.has(token)) {
            throw new Error('Halaman pencarian berulang.');
          }
          if (token) seenTokens.add(token);
        } while (token && !cancelled);
        if (!cancelled) {
          setSearchResults(Array.from(found.values()).sort(
            (a, b) => b.createdAt.localeCompare(a.createdAt)
          ));
        }
      } catch {
        if (!cancelled) {
          setSearchResults([]);
          setSearchError('Pencarian belum selesai. Periksa koneksi atau tunggu sebentar, lalu coba lagi.');
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchRevision]);

  const villages = useMemo(
    () =>
      Array.from(new Set(records.map(r => r.village))).sort((a, b) =>
        a.localeCompare(b, 'id')
      ),
    [records]
  );
  const visible = (searchResults ?? records).filter(
    r => filter === 'all' || r.village === filter
  );
  const total = records.reduce((sum, r) => sum + r.amount, 0);
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRecords = visible.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [query, filter, searchRevision]);

  function changePage(nextPage: number) {
    setPage(Math.max(1, Math.min(nextPage, pageCount)));
    document.getElementById('records-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    setName('');
    setVillage('');
    setAmount('');
    setEditing(null);
    setTranscript('');
    setScanDetail('');
  }

  async function scanEnvelope(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !file.type.startsWith('image/')) { setStatus('Pilih foto yang valid.'); return; }
    setScanning(true); setScanDetail(''); setStatus('OCR lokal membaca foto tanpa AI...');
    try {
      const ocr = await readImage(file);
      const result = parseSingle(ocr.text);
      const matchedVillage = result.village ? bestKnownVillage(result.village, villages) : '';
      setName(result.name);
      setVillage(matchedVillage);
      setAmount(result.amount ? String(result.amount) : '');
      setScanDetail(`OCR lokal · keyakinan ${ocr.confidence}%\nTulisan terbaca:\n${ocr.text}`);
      setStatus('Scan tanpa AI selesai. Periksa hasil lalu tekan Simpan.');
    } catch { setStatus('OCR lokal gagal membaca foto. Coba foto lebih dekat dan terang.'); }
    finally { setScanning(false); }
  }

  function adjustScannedAmount(delta: number) {
    const current = Number(amount) || 0;
    setAmount(String(Math.max(0, current + delta)));
  }

  async function downloadBackup() {
    try {
      setStatus('Menyiapkan backup semua data...');
      const allRecords = await getAllRecords();
      const backup = { format: 'catatan-amplop-backup', version: 2, exportedAt: new Date().toISOString(), records: allRecords };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `catatan-amplop-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStatus(`Backup lengkap ${allRecords.length} data berhasil dibuat.`);
    } catch {
      setStatus('Backup belum berhasil dibuat. Coba lagi.');
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text()) as { format?: string; records?: unknown[] };
      if (backup.format !== 'catatan-amplop-backup' || !Array.isArray(backup.records) || backup.records.length === 0) {
        setStatus('File backup tidak valid.');
        return;
      }
      if (!window.confirm(`Pulihkan ${backup.records.length} data dari backup? Data lama tidak akan dihapus.`)) return;
      let restored = 0;
      for (let start = 0; start < backup.records.length; start += 200) {
        const batch = backup.records.slice(start, start + 200);
        const response = await api.post('/api/restore', { records: batch });
        restored += Number(response.data.restored ?? 0);
        setStatus(`Memulihkan data... ${restored}/${backup.records.length}`);
      }
      await load();
      setStatus(`${restored} data berhasil dipulihkan.`);
    } catch {
      setStatus('Backup gagal dipulihkan. Pastikan file JSON benar.');
    }
  }

  async function downloadPdf() {
    try {
      setStatus('Menyiapkan PDF semua data...');
      const allRecords = await getAllRecords();
      if (allRecords.length === 0) {
        setStatus('Belum ada data untuk dibuat PDF.');
        return;
      }
      const allTotal = allRecords.reduce((sum, record) => sum + record.amount, 0);
      const allVillages = new Set(allRecords.map(record => record.village));
      // Hanya laporan PDF yang diurutkan: desa/alamat A-Z, lalu nama A-Z.
      // Urutan tampilan aplikasi tetap data terbaru di atas.
      const pdfVillageKey = (value: string) => {
        const normalized = normalizeVillage(value)
          .replace(/\b(?:desa|ds|kelurahan|kel)\b/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        // Satukan variasi ejaan desa yang sangat mirip ke nama referensi yang sudah ada.
        let best = normalized;
        let bestScore = 0;
        for (const village of allVillages) {
          const candidate = normalizeVillage(village)
            .replace(/\b(?:desa|ds|kelurahan|kel)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const score = villageSimilarity(normalized, candidate);
          if (score > bestScore) { bestScore = score; best = candidate; }
        }
        return bestScore >= 0.72 ? best : normalized;
      };
      const pdfRecords = [...allRecords].sort((a, b) => {
        const byVillage = pdfVillageKey(a.village).localeCompare(pdfVillageKey(b.village), 'id-ID', { sensitivity: 'base', numeric: true });
        if (byVillage !== 0) return byVillage;
        return a.name.localeCompare(b.name, 'id-ID', { sensitivity: 'base', numeric: true });
      });
      const escapeHtml = (value: string) => value.replace(/[&<>\"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#039;' })[char] ?? char);
      const rows = pdfRecords.map((r, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.village)}</td><td class='money'>${rupiah(r.amount)}</td><td>${new Date(r.createdAt).toLocaleDateString('id-ID')}</td></tr>`).join('');
      const report = `<!doctype html><html><head><meta charset='utf-8'><title>Catatan Amplop</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#0f172a}h1{margin:0 0 4px;font-size:24px}.meta{color:#64748b;margin-bottom:18px}.summary{display:flex;gap:24px;margin:14px 0 20px;font-weight:700}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#f1f5f9}.money{text-align:right;white-space:nowrap}tfoot td{font-weight:700}p.note{font-size:11px;color:#64748b;margin-top:14px}</style></head><body><h1>Catatan Amplop</h1><div class='meta'>Dicetak ${new Date().toLocaleString('id-ID')}</div><div class='summary'><span>Total: ${rupiah(allTotal)}</span><span>${allRecords.length} pemberi</span><span>${allVillages.size} desa</span></div><table><thead><tr><th>No</th><th>Nama</th><th>Desa</th><th>Nominal</th><th>Tanggal</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan='3'>Total Amplop</td><td class='money'>${rupiah(allTotal)}</td><td></td></tr></tfoot></table><p class='note'>Laporan dibuat dari data Catatan Amplop.</p><script>window.onload=()=>{window.print()}<\/script></body></html>`;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setStatus('Browser memblokir halaman PDF. Izinkan pop-up lalu coba lagi.');
      return;
    }
    printWindow.document.open();
    printWindow.document.write(report);
    printWindow.document.close();
      setStatus('Laporan lengkap siap. Pilih Simpan sebagai PDF pada menu cetak.');
    } catch {
      setStatus('PDF belum berhasil dibuat. Coba lagi.');
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const numeric = Number(amount);
    if (
      !name.trim() ||
      !village.trim() ||
      !Number.isSafeInteger(numeric) ||
      numeric <= 0
    ) {
      setStatus('Isi Nama, Desa, dan Nominal dengan benar.');
      return;
    }
    try {
      const payload = {
        name: name.trim(),
        village: village.trim(),
        amount: numeric,
      };
      if (editing) await api.put(`/api/records/${editing}`, payload);
      else await api.post('/api/records', payload);
      resetForm();
      setStatus(
        editing ? 'Data berhasil diperbarui.' : 'Data berhasil disimpan.'
      );
      await load();
    } catch {
      setStatus('Gagal menyimpan data. Silakan coba lagi.');
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Yakin ingin menghapus data ini?')) return;
    try {
      await api.delete(`/api/records/${id}`);
      setStatus('Data berhasil dihapus.');
      await load();
    } catch {
      setStatus('Data belum berhasil dihapus.');
    }
  }

  function beginEdit(r: Item) {
    setEditing(r.id);
    setName(r.name);
    setVillage(r.village);
    setAmount(String(r.amount));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startVoice() {
    if (listening) {
      speechRecognitionRef.current?.stop();
      return;
    }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setStatus('Voice tanpa AI belum didukung browser ini. Gunakan Chrome terbaru.');
      return;
    }
    const recognition = new Recognition();
    speechRecognitionRef.current = recognition;
    recognition.lang = 'id-ID';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setListening(true);
      setStatus('Mendengarkan suara...');
    };
    recognition.onresult = (event: any) => {
      const text = String(event.results?.[0]?.[0]?.transcript ?? '').trim();
      setTranscript(text);
      const parsed = parseVoice(text, villages);
      if (parsed.name) setName(parsed.name);
      if (parsed.village) setVillage(parsed.village);
      if (parsed.amount) setAmount(String(parsed.amount));
      setStatus(parsed.name && parsed.village && parsed.amount ? 'Voice berhasil. Periksa data lalu tekan Simpan.' : 'Suara terbaca. Periksa kolom sebelum Simpan.');
    };
    recognition.onerror = () => setStatus('Voice browser gagal. Periksa izin mikrofon lalu coba lagi.');
    recognition.onend = () => {
      setListening(false);
      speechRecognitionRef.current = null;
    };
    recognition.start();
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4 font-semibold">
          <Mail size={22} /> Catatan Amplop
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <section>
          <p className="text-xs font-semibold tracking-[0.2em] text-slate-500">
            CATATAN WARGA
          </p>
          <h1 className="text-3xl font-bold">Catatan Amplop</h1>
          <p className="text-slate-600">
            Catat dan cari data amplop warga dengan cepat.
          </p>
        </section>
        <section className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Mail size={17} /> Total Data Dimuat
            </div>
            <div className="mt-2 text-2xl font-bold">{rupiah(total)}</div>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Users size={17} /> Pemberi Dimuat
            </div>
            <div className="mt-2 text-2xl font-bold">
              {records.length} orang
            </div>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <MapPin size={17} /> Desa Dimuat
            </div>
            <div className="mt-2 text-2xl font-bold">
              {villages.length} desa
            </div>
          </div>
        </section>
        <BookScanner records={records} onSaved={load} />
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-xl font-semibold">
            {editing ? 'Edit catatan' : 'Tambah catatan'}
          </h2>
          <form className="grid gap-3 md:grid-cols-4" onSubmit={save}>
            <textarea
              className="min-w-0 rounded-xl border px-4 py-3"
              placeholder="Nama pemberi"
              aria-label="Nama pemberi"
              rows={3}
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <textarea
              className="min-w-0 rounded-xl border px-4 py-3"
              placeholder="Nama desa / alamat lengkap"
              aria-label="Nama desa / alamat lengkap"
              rows={3}
              value={village}
              onChange={e => setVillage(e.target.value)}
            />
            <input
              className="rounded-xl border px-4 py-3"
              inputMode="numeric"
              placeholder="Rp0"
              value={amount ? rupiah(Number(amount)) : ''}
              onFocus={e => {
                e.currentTarget.value = amount;
              }}
              onBlur={e => {
                e.currentTarget.value = amount ? rupiah(Number(amount)) : '';
              }}
              onChange={e => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
                setAmount(digits);
              }}
            />
            <button
              className="rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white"
              type="submit"
            >
              {editing ? 'Simpan perubahan' : 'Simpan'}
            </button>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="flex items-center gap-2 rounded-xl border px-4 py-3"
              type="button"
              onClick={startVoice}
            >
              <Mic size={18} />
              {listening ? 'Selesai & Proses' : 'Isi dengan suara'}
            </button>
            <button
              className="flex items-center gap-2 rounded-xl border px-4 py-3"
              type="button"
              disabled={scanning}
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera size={18} /> {scanning ? 'Membaca foto...' : 'Scan Amplop'}
            </button>
            <input ref={cameraInputRef} className="hidden" type="file" accept="image/*" capture="environment" onChange={scanEnvelope} />
            {editing && (
              <button
                className="rounded-xl border px-4 py-3"
                onClick={resetForm}
              >
                Batal edit
              </button>
            )}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Voice tanpa AI. Contoh: “Budi desa Gindo Suli empat puluh ribu”. Ucapkan nama, desa/alamat, lalu nominal.
          </p>
          {transcript && (
            <p className="mt-2 text-sm">Hasil suara: “{transcript}”</p>
          )}
          {scanDetail && (
            <div className="mt-3 rounded-xl border bg-amber-50 p-3 text-sm">
              <p className="whitespace-pre-wrap break-words">{scanDetail}</p>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className="rounded-lg border bg-white px-3 py-2 font-semibold" onClick={() => adjustScannedAmount(-5000)}>− Rp5.000</button>
                <strong>{amount ? rupiah(Number(amount)) : 'Nominal belum terbaca'}</strong>
                <button type="button" className="rounded-lg border bg-white px-3 py-2 font-semibold" onClick={() => adjustScannedAmount(5000)}>+ Rp5.000</button>
              </div>
              <p className="mt-2 text-xs text-slate-600">Periksa semua nama, alamat, dan sumber nominal. Nominal bisa dibaca dari tulisan amplop atau uang yang terlihat. Uang tertutup tidak dapat dihitung.</p>
            </div>
          )}
          {status && (
            <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm">
              {status}
            </p>
          )}
        </section>
        <section id="records-list" className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-4 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 w-full items-center gap-2 rounded-xl border px-3">
              <Search size={18} className="shrink-0" />
              <input
                className="min-w-0 w-full py-3 text-base outline-none"
                placeholder="Cari nama atau desa di seluruh database..."
                value={query}
                onChange={e => {
                  setQuery(e.target.value);
                  setSearchResults(e.target.value.trim() ? [] : null);
                  setSearching(Boolean(e.target.value.trim()));
                  setSearchError('');
                }}
              />
            </div>
            <select
              aria-label="Filter desa"
              className="min-w-0 w-full max-w-full truncate rounded-xl border px-4 py-3 text-base"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            >
              <option value="all">Semua Desa</option>
              {villages.map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <div className="flex min-w-0 flex-wrap gap-3 md:col-span-2">
            <button className="flex items-center justify-center gap-2 rounded-xl border px-4 py-3 font-semibold" type="button" onClick={downloadBackup}><Download size={18} /> Backup Data</button>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border px-4 py-3 font-semibold">Restore Backup<input className="hidden" type="file" accept="application/json,.json" onChange={restoreBackup} /></label>
            <button
              className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white"
              type="button"
              onClick={downloadPdf}
            >
              <Download size={18} /> Download PDF
            </button>
            </div>
          </div>
          {searchError ? (
            <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">
              <p>{searchError}</p>
              <button type="button" className="mt-2 rounded-lg border px-3 py-2 font-semibold" onClick={() => setSearchRevision(current => current + 1)}>Coba lagi</button>
            </div>
          ) : searching ? (
            <p role="status">Mencari ke seluruh database...</p>
          ) : loading ? (
            <p>Memuat catatan...</p>
          ) : visible.length === 0 ? (
            <p className="py-8 text-center text-slate-500">
              Belum ada catatan yang cocok.
            </p>
          ) : (
            <div className="space-y-3">
              {pageRecords.map(r => (
                <article
                  key={r.id}
                  className="grid gap-3 rounded-xl border p-4 md:grid-cols-[1fr_1fr_auto_auto] md:items-center"
                >
                  <div>
                    <div className="font-semibold">{r.name}</div>
                    <div className="whitespace-pre-wrap break-words text-sm text-slate-500">{r.village}</div>
                  </div>
                  <div className="font-semibold">{rupiah(r.amount)}</div>
                  <div className="text-sm text-slate-500">
                    {new Date(r.createdAt).toLocaleString('id-ID')}
                  </div>
                  <div className="flex gap-2">
                    <button
                      aria-label={`Edit ${r.name}`}
                      className="rounded-lg border p-2"
                      onClick={() => beginEdit(r)}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      aria-label={`Hapus ${r.name}`}
                      className="rounded-lg border p-2 text-red-600"
                      onClick={() => remove(r.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </article>
              ))}
              <nav aria-label="Halaman catatan" className="flex flex-wrap items-center justify-center gap-3 pt-3">
                <button className="rounded-xl border px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={() => changePage(currentPage - 1)} disabled={currentPage <= 1}>Sebelumnya</button>
                <span aria-live="polite" className="text-sm font-semibold">Halaman {currentPage} dari {pageCount}</span>
                <button className="rounded-xl border px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={() => changePage(currentPage + 1)} disabled={currentPage >= pageCount}>Berikutnya</button>
              </nav>
              <p className="text-center text-sm text-slate-500">Menampilkan {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, visible.length)} dari {visible.length} data · 50 data per halaman</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
