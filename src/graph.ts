import axios from "axios";

let cachedToken: string | null = null;
let tokenExpiry = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await axios.post(
    `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID!,
      client_secret: process.env.GRAPH_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  cachedToken = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
  return cachedToken;
}

function makeDriveRootUrl(relativePath: string) {
  return `https://graph.microsoft.com/v1.0/drives/${process.env.GRAPH_DRIVE_ID}/root:/${process.env.GRAPH_BASE_FOLDER}/${relativePath}`;
}

export async function uploadJsonToSharePoint(relativePath: string, json: any) {
  const token = await getAccessToken();
  const url = `${makeDriveRootUrl(relativePath)}:/content`;

  await axios.put(url, JSON.stringify(json, null, 2), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export async function getJsonFromSharePoint<T = any>(relativePath: string, fallback: T): Promise<T> {
  const token = await getAccessToken();
  const url = `${makeDriveRootUrl(relativePath)}:/content`;

  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (typeof res.data === "string") {
      return JSON.parse(res.data) as T;
    }
    return res.data as T;
  } catch {
    return fallback;
  }
}
