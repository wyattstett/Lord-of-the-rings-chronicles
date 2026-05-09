module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({ ok: true, app: "Middle-earth Chronicles", version: "0.1.0", backend: "vercel-serverless" });
};
