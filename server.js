onst express = require('express');
const cors    = require('cors');
const https   = require('https');
const app     = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));

app.options('*', cors({ origin: '*' }));

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'ConstruDO OCR' });
});

app.post('/ocr', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });
  }

  const body = JSON.stringify(req.body);

  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length':    Buffer.byteLength(body)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        res.status(apiRes.statusCode).json(JSON.parse(data));
      } catch(e) {
        res.status(500).json({ error: 'Respuesta inválida', raw: data.slice(0,200) });
      }
    });
  });

  apiReq.on('error', err => {
    res.status(500).json({ error: err.message });
  });

  apiReq.write(body);
  apiReq.end();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log('ConstruDO OCR en puerto ' + PORT));
