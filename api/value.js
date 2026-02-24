export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const address = (req.query.address || "").toString().trim();
  const provider = "attom";

  if (!address) {
    return res.status(400).json({ error: "address query param is required" });
  }

  const ATTOM_API_KEY = process.env.ATTOM_API_KEY;
  const tried = [];

  const toNumber = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  async function fetchJson(url, options = {}) {
    const resp = await fetch(url, options);
    const text = await resp.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
    return { resp, data };
  }

  async function getAttomValue(addr) {
    if (!ATTOM_API_KEY) {
      tried.push({ step: "attom:missing-key", ok: false });
      return { value: null, source: null, attomId: null, status: null };
    }

    const headers = { apikey: ATTOM_API_KEY, accept: "application/json" };

    try {
      const propertyUrl =
        "https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail?address=" +
        encodeURIComponent(addr);

      const { resp: propertyResp, data: propertyData } = await fetchJson(propertyUrl, { headers });
      const property = propertyData?.property?.[0] ?? null;
      const attomId = property?.identifier?.attomId ?? null;

      const assessmentValue =
        toNumber(property?.assessment?.market?.mktTtlValue) ??
        toNumber(property?.assessment?.tax?.assdTtlValue);

      tried.push({
        step: "attom:property/detail",
        ok: propertyResp.ok,
        code: propertyResp.status,
        attomId,
        assessmentValue,
      });

      let avmValue = null;
      let avmStatus = null;

      if (attomId) {
        const avmByIdUrl =
          "https://api.gateway.attomdata.com/propertyapi/v1.0.0/avm/detail?attomId=" +
          encodeURIComponent(attomId);

        const { resp: avmByIdResp, data: avmByIdData } = await fetchJson(avmByIdUrl, { headers });

        avmStatus = avmByIdData?.status || { code: avmByIdResp.status };
        avmValue =
          toNumber(avmByIdData?.property?.[0]?.avm?.amount?.value) ??
          toNumber(avmByIdData?.property?.[0]?.avm?.amount);

        tried.push({
          step: "attom:avm/detail?attomId",
          ok: avmByIdResp.ok,
          code: avmByIdResp.status,
          avmValue,
        });
      }

      if (avmValue == null) {
        const avmByAddressUrl =
          "https://api.gateway.attomdata.com/propertyapi/v1.0.0/avm/detail?address=" +
          encodeURIComponent(addr);

        const { resp: avmByAddressResp, data: avmByAddressData } = await fetchJson(avmByAddressUrl, { headers });

        if (!avmStatus) avmStatus = avmByAddressData?.status || { code: avmByAddressResp.status };
        avmValue =
          toNumber(avmByAddressData?.property?.[0]?.avm?.amount?.value) ??
          toNumber(avmByAddressData?.property?.[0]?.avm?.amount);

        tried.push({
          step: "attom:avm/detail?address",
          ok: avmByAddressResp.ok,
          code: avmByAddressResp.status,
          avmValue,
        });
      }

      const finalValue = avmValue ?? assessmentValue ?? null;
      const source = avmValue != null ? "avm" : assessmentValue != null ? "assessment" : null;

      return {
        value: finalValue,
        source,
        attomId,
        status: { avm: avmStatus },
      };
    } catch (e) {
      tried.push({ step: "attom:error", ok: false, message: e?.message || "unknown" });
      return { value: null, source: null, attomId: null, status: null };
    }
  }

  try {
    const attom = await getAttomValue(address);

    return res.status(200).json({
      address,
      provider,
      resolvedProvider: "attom",
      value: attom.value,
      marketValue: attom.value,
      values: { attom: attom.value },
      attomId: attom.attomId ?? null,
      attomSource: attom.source ?? null,
      status: { attom: attom.status ?? null },
      tried,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Internal error while fetching ATTOM value",
      details: err?.message || "unknown error",
    });
  }
}
