let fetchImpl = globalThis.fetch;

async function resolveFetch() {
  if (fetchImpl) return fetchImpl;

  const mod = await import('node-fetch');
  fetchImpl = mod.default;
  return fetchImpl;
}

export async function fetchActiveAlerts({ token, ifModifiedSince }) {
  if (!token) {
    throw new Error('Missing alerts token');
  }

  const fetchFn = await resolveFetch();
  const headers = {
    Authorization: `Bearer ${token}`
  };

  if (ifModifiedSince) {
    headers['If-Modified-Since'] = ifModifiedSince;
  }

  const response = await fetchFn('https://api.alerts.in.ua/v1/alerts/active.json', {
    method: 'GET',
    headers
  });

  const lastModified = response.headers.get('last-modified');

  if (response.status === 304) {
    return { status: 304, data: null, lastModified };
  }

  if (response.status !== 200) {
    const bodyText = await response.text().catch(() => '');
    const error = new Error(`alerts api error: ${response.status}`);
    error.status = response.status;
    error.body = bodyText;
    error.lastModified = lastModified;
    throw error;
  }

  const data = await response.json();
  return { status: 200, data, lastModified };
}
