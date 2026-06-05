const express = require('express');
const cors    = require('cors');
const https   = require('https');
const multer  = require('multer');
const app     = express();
const upload  = multer({ limits: { fileSize: 15 * 1024 * 1024 } });

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '15mb' }));
app.options('*', cors({ origin: '*' }));

const MODEL  = 'claude-opus-4-5';
const SYSTEM = 'Eres OCR experto en facturas dominicanas. Devuelve SOLO JSON sin markdown. Formato: {"numero":"","fecha":"YYYY-MM-DD","proveedor":"","rnc":"","ncf":"","tipo":"Material de construcción","items":[{"desc":"","cant":1,"pu":0,"sub":0}],"subtotal":0,"itbis":0,"total":0,"partida_sugerida_desc":"","confianza":90}. Tipos: Material de construcción, Hormigón premezclado, Mano de obra, Alquiler de equipo, Servicios profesionales, Transporte, Otro. Números sin comas ni símbolos.';

function callAnthropic(bodyObj, cb, usePDFBeta) {
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) return cb(new Error('ANTHROPIC_API_KEY no configurada'));
  const body = JSON.stringify(bodyObj);
  const headers = {
    'Content-Type':      'application/json',
    'x-api-key':         API_KEY,
    'anthropic-version': '2023-06-01',
    'Content-Length':    Buffer.byteLength(body)
  };
  if (usePDFBeta) headers['anthropic-beta'] = 'pdfs-2024-09-25';
  const req = https.request({
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (res.statusCode !== 200) return cb(new Error('Anthropic ' + res.statusCode + ': ' + (parsed.error?.message || data.slice(0,200))));
        const text = (parsed.content || []).map(c => c.text || '').join('').trim();
        cb(null, text);
      } catch(e) { cb(new Error('Parse error: ' + data.slice(0,200))); }
    });
  });
  req.on('error', cb);
  req.write(body);
  req.end();
}

function parseResult(raw) {
  let obj = {};
  try { obj = JSON.parse(raw); } catch(e) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch(e2) {} }
  }
  const n = v => typeof v === 'number' ? v : parseFloat(String(v||0).replace(/[^0-9.]/g,'')) || 0;
  obj.subtotal = n(obj.subtotal);
  obj.itbis    = n(obj.itbis);
  obj.total    = n(obj.total) || obj.subtotal + obj.itbis;
  if (!obj.itbis && obj.subtotal) obj.itbis = Math.round(obj.subtotal * 0.18);
  obj.items = (obj.items||[]).map(it => ({
    desc: String(it.desc||'Item'), cant: n(it.cant)||1,
    pu: n(it.pu)||0, sub: n(it.sub)||(n(it.cant||1)*n(it.pu||0))
  }));
  if (!obj.items.length) obj.items = [{ desc: 'Ver factura', cant: 1, pu: obj.subtotal, sub: obj.subtotal }];
  return obj;
}

app.get('/', (req, res) => res.json({ status: 'ok', service: 'ConstruDO OCR v2', model: MODEL }));

// PDF
app.post('/ocr/pdf', upload.single('pdf'), (req, res) => {
  console.log('PDF recibido:', req.file ? req.file.size + ' bytes' : 'NINGUNO');
  if (!req.file) return res.status(400).json({ error: 'No se recibió PDF' });
  const b64 = req.file.buffer.toString('base64');
  const bodyObj = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    betas: ['pdfs-2024-09-25'],
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 }},
        { type: 'text', text: 'Extrae todos los datos de esta factura y devuelve SOLO el JSON.' }
      ]
    }]
  };
  callAnthropic(bodyObj, (err, text) => {
    if (err) return res.status(500).json({ error: err.message });
    console.log('PDF resultado:', text.slice(0, 100));
    res.json({ success: true, data: parseResult(text) });
  }, true);
});

// Imagen
app.post('/ocr/image', upload.single('image'), (req, res) => {
  console.log('Imagen recibida:', req.file ? req.file.size + ' bytes' : 'NINGUNO');
  if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });
  const b64 = req.file.buffer.toString('base64');
  const mt  = req.file.mimetype.includes('png') ? 'image/png' :
               req.file.mimetype.includes('webp') ? 'image/webp' : 'image/jpeg';
  const bodyObj = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mt, data: b64 }},
        { type: 'text', text: 'Extrae todos los datos de esta factura y devuelve SOLO el JSON.' }
      ]
    }]
  };
  callAnthropic(bodyObj, (err, text) => {
    if (err) return res.status(500).json({ error: err.message });
    console.log('Imagen resultado:', text.slice(0, 100));
    res.json({ success: true, data: parseResult(text) });
  }, false);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('ConstruDO OCR v2 en puerto ' + PORT));
