export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const address = (req.query.address || "").toString().trim();
  const provider = (req.query.provider || "auto").toString().toLowerCase(); // attom | rentcast | auto

  if (!address) {
    return res.status(400).json({ error: "address query param is required" });
  }

  const ATTOM_API_KEY = process.env.ATTOM_API_KEY;
  const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY;

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
      // 1) property/detail
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

      // 2) avm by attomId
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

      // 3) avm by address fallback
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

      const finalAttomValue = avmValue ?? assessmentValue ?? null;
      const attomSource =
        avmValue != null ? "avm" : assessmentValue != null ? "assessment" : null;

      return {
        value: finalAttomValue,
        source: attomSource,
        attomId,
        status: { avm: avmStatus },
      };
    } catch (e) {
      tried.push({ step: "attom:error", ok: false, message: e?.message || "unknown" });
      return { value: null, source: null, attomId: null, status: null };
    }
  }

  async function getRentcastValue(addr) {
    if (!RENTCAST_API_KEY) {
      tried.push({ step: "rentcast:missing-key", ok: false });
      return { value: null, status: null };
    }

    // Endpoint farklıysa sadece bu URL'i değiştir.
    const url =
      "https://api.rentcast.io/v1/avm/value?address=" + encodeURIComponent(addr);

    try {
      const { resp, data } = await fetchJson(url, {
        headers: {
          "X-Api-Key": RENTCAST_API_KEY,
          accept: "application/json",
        },
      });

      // Farklı response şemalarına tolerans
      const value =
        toNumber(data?.price) ??
        toNumber(data?.value) ??
        toNumber(data?.avm?.value) ??
        toNumber(data?.avm) ??
        null;

      tried.push({
        step: "rentcast:avm/value",
        ok: resp.ok,
        code: resp.status,
        rentcastValue: value,
      });

      return {
        value,
        status: { code: resp.status, ok: resp.ok },
      };
    } catch (e) {
      tried.push({ step: "rentcast:error", ok: false, message: e?.message || "unknown" });
      return { value: null, status: null };
    }
  }

  try {
    let attom = { value: null, source: null, attomId: null, status: null };
    let rentcast = { value: null, status: null };

    if (provider === "attom") {
      attom = await getAttomValue(address);
    } else if (provider === "rentcast") {
      rentcast = await getRentcastValue(address);
    } else {
      // auto: ikisini de çağır
      [attom, rentcast] = await Promise.all([getAttomValue(address), getRentcastValue(address)]);
    }

    // Auto fallback: ATTOM yoksa RentCast'i ana value yap
    const resolvedValue =
      provider === "attom"
        ? attom.value
        : provider === "rentcast"
        ? rentcast.value
        : attom.value ?? rentcast.value ?? null;

    const resolvedProvider =
      provider === "attom"
        ? "attom"
        : provider === "rentcast"
        ? "rentcast"
        : attom.value != null
        ? "attom"
        : rentcast.value != null
        ? "rentcast"
        : null;

    return res.status(200).json({
      address,
      provider, // requested
      resolvedProvider, // chosen by fallback
      value: resolvedValue,
      marketValue: resolvedValue,

      // UI'da ikisini de göstermek için:
      values: {
        attom: attom.value,
        rentcast: rentcast.value,
      },

      // ATTOM detayları
      attomId: attom.attomId ?? null,
      attomSource: attom.source ?? null,
      status: {
        attom: attom.status ?? null,
        rentcast: rentcast.status ?? null,
      },
      tried,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Internal error while fetching values",
      details: err?.message || "unknown error",
    });
  }
}
