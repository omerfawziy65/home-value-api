export default async function handler(req, res) {
  try {
    const { address } = req.query

    if (!address) {
      return res.status(400).json({ error: "address query param is required" })
    }

    const API_KEY = process.env.ATTOM_API_KEY
    if (!API_KEY) {
      return res.status(500).json({ error: "ATTOM_API_KEY is missing in env" })
    }

    const headers = { apikey: API_KEY }

    // 1) Önce property/detail ile attomId bul
    const propUrl = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?address=${encodeURIComponent(
      address
    )}`

    const propResp = await fetch(propUrl, { headers })
    const propData = await propResp.json()

    const attomId =
      propData?.property?.[0]?.identifier?.attomId ??
      propData?.property?.[0]?.identifier?.Id ??
      propData?.status?.attomId ??
      null

    // Helper: değeri farklı olası alanlardan çek
    const pickMarketValue = (data) => {
      // AVM bazen avm.* içinde döner (planına göre değişebilir)
      const avmValue =
        data?.property?.[0]?.avm?.amount?.value ??
        data?.property?.[0]?.avm?.value ??
        data?.property?.[0]?.avm?.amount ??
        null

      // Bazı yanıtlarda assessment.market içinde olabilir
      const assessmentValue =
        data?.property?.[0]?.assessment?.market?.mktTtlValue ?? null

      return avmValue ?? assessmentValue
    }

    // 2) attomId bulduysak AVM’yi attomId ile dene
    let avmData = null
    let marketValue = null
    let avmTried = null

    if (attomId) {
      const avmByIdUrl = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/avm/detail?attomId=${encodeURIComponent(
        attomId
      )}`

      const avmResp = await fetch(avmByIdUrl, { headers })
      avmData = await avmResp.json()
      avmTried = { mode: "attomId", url: avmByIdUrl, http: avmResp.status }

      marketValue = pickMarketValue(avmData)
    }

    // 3) attomId ile AVM boş döndüyse -> address ile AVM’yi dene (fallback)
    if (marketValue == null) {
      const avmByAddressUrl = `https://api.gateway.attomdata.com/propertyapi/v1.0.0/avm/detail?address=${encodeURIComponent(
        address
      )}`

      const avmResp2 = await fetch(avmByAddressUrl, { headers })
      const avmData2 = await avmResp2.json()

      // Eğer ilk avmData yoksa bunu sakla, varsa "fallback" olarak ekle
      if (!avmData) avmData = avmData2

      avmTried = {
        ...(avmTried || {}),
        fallback: { mode: "address", url: avmByAddressUrl, http: avmResp2.status },
      }

      marketValue = pickMarketValue(avmData2)
    }

    // Sonuç
    return res.status(200).json({
      address,
      attomId,
      marketValue,
      status: {
        property: propData?.status ?? null,
        avm: avmData?.status ?? null,
      },
      tried: avmTried,
    })
  } catch (err) {
    return res.status(500).json({
      error: "server_error",
      message: err?.message || String(err),
    })
  }
}
