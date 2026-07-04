const $ = (id) => document.getElementById(id);

let profile = null;
let foundDomain = null;
let foundEmail = null;

function setStatus(msg, type) {
    const el = $('status');
    el.textContent = msg;
    el.className = `status show ${type}`;
}

function apiCall(backendUrl, path, method, body) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { type: 'API_CALL', url: `${backendUrl}${path}`, method, body },
            (res) => {
                if (!res || !res.ok) reject(new Error(res?.error ?? 'Request failed'));
                else resolve(res.data);
            }
        );
    });
}

async function init() {
    const { backendUrl = 'http://localhost:5000' } = await chrome.storage.local.get('backendUrl');
    $('backend-url').value = backendUrl;

    $('backend-url').addEventListener('change', () => {
        chrome.storage.local.set({ backendUrl: $('backend-url').value.trim() });
    });

    $('btn-local').addEventListener('click', () => {
        $('backend-url').value = 'http://localhost:5000';
        chrome.storage.local.set({ backendUrl: 'http://localhost:5000' });
    });
    $('btn-prod').addEventListener('click', () => {
        $('backend-url').value = 'https://emlfn.lightning-revenue.com';
        chrome.storage.local.set({ backendUrl: 'https://emlfn.lightning-revenue.com' });
    });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const isLinkedIn = tab?.url?.includes('linkedin.com/in/');

    if (!isLinkedIn) {
        $('not-linkedin').style.display = 'block';
        return;
    }

    $('main').style.display = 'block';
    // Store profile URL for scraping
    profile = { profileUrl: tab.url };

    $('btn-find').addEventListener('click', onFind);
    $('btn-save').addEventListener('click', onSave);
}

async function onFind() {
    const backendUrl = $('backend-url').value.trim();
    $('btn-find').disabled = true;
    setStatus('Scraping LinkedIn profile...', 'loading');

    try {
        // Step 1: scrape profile via backend → ScraperAPI
        const scraped = await apiCall(backendUrl, '/api/prospect/linkedin-profile', 'POST', {
            profileUrl: profile.profileUrl,
        });

        profile = { ...profile, ...scraped };

        $('f-name').textContent = [scraped.firstName, scraped.lastName].filter(Boolean).join(' ') || '—';
        $('f-name').classList.remove('empty');
        $('f-title').textContent = scraped.role || '—';
        $('f-title').classList.remove('empty');

        foundDomain = scraped.domain || null;
        $('f-domain').textContent = foundDomain || 'not found';
        $('f-domain').classList.toggle('empty', !foundDomain);

        if (!scraped.firstName) {
            setStatus('Could not extract profile data. Profile may be private.', 'error');
            return;
        }

        if (!foundDomain) {
            setStatus('Profile found but no company domain detected.', 'error');
            return;
        }

        setStatus('Domain found. Searching for email...', 'loading');

        // Step 2: find email via existing find-email endpoint
        const emailRes = await apiCall(
            backendUrl,
            `/api/verifier/find-email?firstName=${encodeURIComponent(scraped.firstName ?? '')}&lastName=${encodeURIComponent(scraped.lastName ?? '')}&domain=${encodeURIComponent(foundDomain)}`,
            'GET'
        );

        foundEmail = emailRes?.email ?? null;
        $('f-email').textContent = foundEmail ?? 'not found';
        $('f-email').classList.toggle('empty', !foundEmail);

        if (foundEmail) {
            setStatus('Email found!', 'success');
            $('btn-save').style.display = 'block';
        } else {
            setStatus('No verified email found for this domain.', 'error');
        }
    } catch (err) {
        setStatus(`Error: ${err.message}`, 'error');
    } finally {
        $('btn-find').disabled = false;
    }
}

async function onSave() {
    if (!foundEmail) return;

    const backendUrl = $('backend-url').value.trim();
    $('btn-save').disabled = true;
    setStatus('Saving...', 'loading');

    try {
        await apiCall(backendUrl, '/api/verifier/verify-single', 'POST', {
            email: foundEmail,
            firstName: profile.firstName,
            lastName: profile.lastName,
            domain: foundDomain,
            source: 'linkedin-extension',
        });

        setStatus('Saved to BrandNav!', 'success');
        $('btn-save').style.display = 'none';
    } catch (err) {
        setStatus(`Save failed: ${err.message}`, 'error');
        $('btn-save').disabled = false;
    }
}

init();
