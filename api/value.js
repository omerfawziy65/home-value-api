export default async function handler(req, res) {
  const { address } = req.query;

  const response = await fetch(
    `https://api.gateway.attomdata.com/propertyapi/v1.0.0/avm/detail?address=${encodeURIComponent(address)}`,
    {
      headers: {
        apikey: process.env.ATTOM_API_KEY,
      },
    }
  );

  const data = await response.json();
  res.status(200).json(data);
}
