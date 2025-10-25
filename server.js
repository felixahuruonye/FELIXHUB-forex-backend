// server.js
// Node 18+ recommended. Install deps: express node-fetch jsonwebtoken cors dotenv
//
// npm init -y
// npm i express node-fetch jsonwebtoken cors dotenv

import express from 'express';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(express.json());
app.use(cors());

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET || ''; // add your Paystack secret on deploy
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const IPGEO_API_KEY = process.env.IPGEO_API_KEY || ''; // optional for IP-based timezone lookup

// Configurable limits
const FREE_TOTAL_SEARCHES = 20;   // free general searches
const FREE_PREMIUM_TRIALS = 1;    // premium features free trial count

// Helpers
function signToken(payload) {
  // token expires in 365 days by default - you can change
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '365d' });
}
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// Simple route health check
app.get('/', (req, res) => res.send({ ok: true, message: "Timezone API backend running" }));

/**
 * Geocode: get lat/lon + postal + display name from "city, country"
 * Query param: q = "San Francisco, California" or "Owerri, Nigeria"
 */
app.get('/api/geocode', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q query param required (e.g. q=Owerri,Nigeria)' });

    // Nominatim OpenStreetMap
    const nmUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const r = await fetch(nmUrl, { headers: { 'User-Agent': 'Felix-Time-App/1.0' } });
    const arr = await r.json();
    if (!arr || arr.length === 0) return res.status(404).json({ error: 'location_not_found' });

    const best = arr[0];
    // try to find postal code if present in address (Nominatim returns display_name + boundingbox + lat lon)
    const result = {
      display_name: best.display_name,
      lat: best.lat,
      lon: best.lon,
      type: best.type || null,
      osm_id: best.osm_id || null,
      boundingbox: best.boundingbox || null,
      // Nominatim sometimes includes 'address' field in other endpoints; minimal here
    };
    return res.json({ ok: true, location: result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Time lookup by coords OR by IANA timezone.
 * POST /api/time  body: { lat, lon } OR { timezone: "America/New_York" }
 * Returns current time, offset, timezone name, and a formatted local time string.
 */
app.post('/api/time', async (req, res) => {
  try {
    const { lat, lon, timezone } = req.body || {};
    let data = null;

    if (timezone) {
      // use worldtimeapi for known IANA timezone name
      const w = await fetch(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(timezone)}`);
      if (!w.ok) return res.status(400).json({ error: 'invalid_timezone' });
      const j = await w.json();
      data = {
        provider: 'worldtimeapi',
        timezone: j.timezone,
        utc_offset: j.utc_offset,
        datetime: j.datetime,
        unixtime: j.unixtime,
        raw: j
      };
      return res.json({ ok: true, data });
    }

    if (!lat || !lon) return res.status(400).json({ error: 'provide lat & lon or timezone' });

    // Try TimeAPI.io endpoint (coordinate based) - no key required for basic usage
    const turl = `https://timeapi.io/api/Time/current/coordinate?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
    const tr = await fetch(turl);
    if (tr.ok) {
      const tj = await tr.json();
      // tj contains dateTime, timeZone, utcOffset etc.
      data = {
        provider: 'timeapi.io',
        timezone: tj.timeZone,
        utc_offset: tj.utcOffset,
        datetime: tj.dateTime,
        raw: tj
      };
      return res.json({ ok: true, data });
    }

    // Fallback: use ipgeolocation (if key provided)
    if (IPGEO_API_KEY) {
      const ipUrl = `https://api.ipgeolocation.io/timezone?apiKey=${IPGEO_API_KEY}&lat=${encodeURIComponent(lat)}&long=${encodeURIComponent(lon)}`;
      const ipr = await fetch(ipUrl);
      if (ipr.ok) {
        const ipj = await ipr.json();
        data = {
          provider: 'ipgeolocation',
          timezone: ipj.timezone || ipj.timezone.name || null,
          utc_offset: ipj.timezone_offset || null,
          datetime: ipj.date_time || null,
          raw: ipj
        };
        return res.json({ ok: true, data });
      }
    }

    // If none works, return an error
    return res.status(502).json({ error: 'time_provider_failed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * IP lookup (optional) - returns location + timezone for the caller IP or for specified IP.
 * GET /api/ip?ip= (if no ip param, will detect caller IP via request headers)
 * This uses ipgeolocation.io if key is set, otherwise uses a free ipinfo fallback (note: ipinfo may rate limit).
 */
app.get('/api/ip', async (req, res) => {
  try {
    const ip = (req.query.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (!IPGEO_API_KEY) {
      // fallback to ipinfo.io (free limited)
      const target = ip ? ip : '';
      const r = await fetch(`https://ipinfo.io/${target}/json`);
      if (!r.ok) return res.status(500).json({ error: 'ip_lookup_failed' });
      const j = await r.json();
      // ipinfo returns { ip, city, region, country, loc: "lat,lon", postal, timezone }
      return res.json({ ok: true, provider: 'ipinfo', data: j });
    }
    // ipgeolocation
    const ipUrl = `https://api.ipgeolocation.io/ipgeo?apiKey=${IPGEO_API_KEY}${ip ? `&ip=${encodeURIComponent(ip)}` : ''}&include=timezone`;
    const r = await fetch(ipUrl);
    const j = await r.json();
    return res.json({ ok: true, provider: 'ipgeolocation', data: j });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Paystack verification endpoint.
 * POST /api/verify-paystack  body: { reference }
 * On success: returns { ok:true, token } where token is a signed JWT with premium access info.
 *
 * You MUST set PAYSTACK_SECRET env var for this to work.
 */
app.post('/api/verify-paystack', async (req, res) => {
  try {
    const { reference } = req.body || {};
    if (!reference) return res.status(400).json({ error: 'reference_required' });
    if (!PAYSTACK_SECRET) return res.status(500).json({ error: 'paystack_missing_secret' });

    const verifyUrl = `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`;
    const r = await fetch(verifyUrl, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, 'Content-Type': 'application/json' }
    });
    const j = await r.json();
    if (!j || !j.data || j.status !== true || j.data.status !== 'success') {
      return res.status(400).json({ error: 'payment_not_successful', raw: j });
    }

    // Payment is successful. Create a token for the user.
    // You may include email or customer info from j.data.customer.email (if present)
    const customerEmail = (j.data && j.data.customer && j.data.customer.email) ? j.data.customer.email : null;

    const payload = {
      premium: true,
      email: customerEmail,
      paid_reference: reference,
      // counts: grant them unlimited premium searches or set a limit you want
      remaining_premium_trials: 9999, // or you can set to a large number / subscription logic
      remaining_total_searches: 99999,
      issued_at: Date.now()
    };
    const token = signToken(payload);
    return res.json({ ok: true, token, payload: { email: customerEmail } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server_error' });
  }
});

/**
 * Middleware to check usage/quota using token in Authorization header or token body param.
 * For simplicity we return token decoded so frontend can control counts locally.
 */
app.post('/api/check-token', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s*/i, '') || req.body.token || null;
  if (!token) return res.json({ ok: false, reason: 'no_token', freeTrialPremiumLeft: FREE_PREMIUM_TRIALS, freeTotalSearchLeft: FREE_TOTAL_SEARCHES });

  const decoded = verifyToken(token);
  if (!decoded) return res.json({ ok: false, reason: 'invalid_token' });

  return res.json({ ok: true, token: decoded });
});

/**
 * For production: you should also implement a webhook listener (Paystack webhook) that updates server DB.
 * This example keeps things stateless and returns a signed token to the frontend on manual verify.
 */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
