res.setHeader("Access-Control-Allow-Origin", "*")
res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS")
res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

if (req.method === "OPTIONS") {
  return res.status(200).end()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apikey = process.env.ATTOM_API_KEY;
  if (!apikey) {
    return res.status(500).json({ error: 'Missing ATTOM_API_KEY' });
  }

  const address = (req.query.address || '').toString().trim();
  if (!address) {
    return res.status(400).json({ error: 'address query param is required' });
  }

  const tried = [];

  try {
    const propertyUrl =
      `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?address=` +
      encodeURIComponent(address);

    const propertyResp = await fetch(propertyUrl, {
      headers: { apikey, accept: 'application/json' },
    });

    const propertyData = await propertyResp.json().catch(() => ({}));

    const property = propertyData?.property?.[0] ?? null;
    const attomId = property?.identifier?.attomId ?? null;

    const assessmentValue =
      property?.assessment?.market?.mktTtlValue ??
      property?.assessment?.tax?.assdTtlValue ??
      null;

    tried.push({
      step: 'property/detail',
      ok: propertyResp.ok,
      code: propertyResp.status,
      attomId,
      assessmentValue,
    });

    let avmValue = null;
    let avmStatus = null;

    if (attomId) {
      const avmByIdUrl =
        `https://api.gateway.attomdata.com/propertyapi/v1.0.0/avm/detail?attomId=` +
        encodeURIComponent(attomId);

      const avmByIdResp = await fetch(avmByIdUrl, {
        headers: { apikey, accept: 'application/json' },
      });
      const avmByIdData = await avmByIdResp.json().catch(() => ({}));

      avmStatus = avmByIdData?.status || { code: avmByIdResp.status };
      avmValue =
        avmByIdData?.property?.[0]?.avm?.amount?.value ??
        avmByIdData?.property?.[0]?.avm?.amount ??
        null;

      tried.push({
        step: 'avm/detail?attomId',
        ok: avmByIdResp.ok,
        code: avmByIdResp.status,
        avmValue,
      });
    }

    if (avmValue == null) {
      const avmByAddressUrl =
        `https://api.gateway.attomdata.com/propertyapi/v1.0.0/avm/detail?address=` +
        encodeURIComponent(address);

      const avmByAddressResp = await fetch(avmByAddressUrl, {
        headers: { apikey, accept: 'application/json' },
      });
      const avmByAddressData = await avmByAddressResp.json().catch(() => ({}));

      if (!avmStatus) {
        avmStatus = avmByAddressData?.status || { code: avmByAddressResp.status };
      }

      avmValue =
        avmByAddressData?.property?.[0]?.avm?.amount?.value ??
        avmByAddressData?.property?.[0]?.avm?.amount ??
        null;

      tried.push({
        step: 'avm/detail?address',
        ok: avmByAddressResp.ok,
        code: avmByAddressResp.status,
        avmValue,
      });
    }

    const value = avmValue ?? assessmentValue ?? null;
    const source = avmValue != null ? 'avm' : assessmentValue != null ? 'assessment' : null;

    return res.status(200).json({
      address,
      attomId,
      value,
      marketValue: value,
      source,
      status: {
        avm: avmStatus,
      },
      tried,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Internal error while fetching ATTOM data',
      details: err?.message || 'unknown error',
    });
  }
}
