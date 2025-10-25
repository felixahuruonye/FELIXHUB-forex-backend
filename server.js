import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const IPGEO_API_KEY = process.env.IPGEO_API_KEY; // You already added this in Render

// ✅ Route 1: Get IP and location info
app.get("/ipinfo", async (req, res) => {
  try {
    const response = await fetch(`https://api.ipgeolocation.io/ipgeo?apiKey=${IPGEO_API_KEY}`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch IP info" });
  }
});

// ✅ Route 2: Get accurate time using WorldTimeAPI
app.get("/get-time", async (req, res) => {
  const location = req.query.location;
  if (!location) return res.status(400).json({ error: "No location provided" });

  try {
    // Extract city or country name
    const query = encodeURIComponent(location.trim());
    const response = await fetch(`https://worldtimeapi.org/api/ip`);
    const data = await response.json();

    if (!data.datetime) {
      return res.status(404).json({ error: "Could not fetch time" });
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch time" });
  }
});

app.get("/", (req, res) => res.send("FELIXHUB Forex Backend Running ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
