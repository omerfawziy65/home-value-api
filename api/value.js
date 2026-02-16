export default async function handler(req, res) {
  const { address } = req.query;

  try {
    const response = await fetch(
  `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile?address=${encodeURIComponent(address)}`,
  {
    headers: {
      apikey: process.env.ATTOM_API_KEY,
    },
  }
);


    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    res.status(500).json({ error: "Server error", details: error.message });
  }
}
