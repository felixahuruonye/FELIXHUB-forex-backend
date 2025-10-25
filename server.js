app.get("/get-time", async (req, res) => {
  const location = req.query.location;
  if (!location) return res.status(400).json({ error: "No location provided" });

  try {
    const encoded = encodeURIComponent(location);
    const response = await fetch(`https://worldtimeapi.org/api/timezone`);
    const zones = await response.json();

    const found = zones.find(z => z.toLowerCase().includes(location.toLowerCase()));
    if (!found) return res.status(404).json({ error: "Timezone not found" });

    const timeRes = await fetch(`https://worldtimeapi.org/api/timezone/${found}`);
    const data = await timeRes.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch time" });
  }
});
