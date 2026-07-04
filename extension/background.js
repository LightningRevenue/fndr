// Relay API calls from popup to backend (avoids CORS issues from popup context)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'API_CALL') {
        fetch(msg.url, {
            method: msg.method ?? 'GET',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: msg.body ? JSON.stringify(msg.body) : undefined,
        })
            .then((r) => r.json())
            .then((data) => sendResponse({ ok: true, data }))
            .catch((err) => sendResponse({ ok: false, error: err.message }));

        return true; // keep channel open for async response
    }
});
