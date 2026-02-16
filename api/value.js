export default async function handler(req, res) {
  const { address } = req.query

  if (!address) {
    return res.status(400).json({ error: "address query param is required" })
  }

  const response = await fetch(
    `https://api.gateway.attomdata.com/propertyapi/v1.0.0/avm/detail?address=${encodeURIComponent(
      address
    )}`,
    {
      headers: {
        apikey: process.env.ATTOM_API_KEY,
      },
    }
  )

  const data = await response.json()

  const marketValue =
    data?.property?.[0]?.assessment?.market?.mktTtlValue ?? null

  return res.status(200).json({
    address,
    marketValue,
    rawStatus: data?.status ?? null,
  })
}
