// Extracts profile data from LinkedIn profile page DOM
function extractProfile() {
    const nameEl = document.querySelector('h1.text-heading-xlarge, h1[class*="heading"]');
    const titleEl = document.querySelector('.text-body-medium.break-words, [class*="headline"]');

    // Company: try experience section first, fallback to subtitle
    const companyEl =
        document.querySelector('.pv-text-details__right-panel .hoverable-link-text') ||
        document.querySelector('[class*="experience"] .hoverable-link-text') ||
        document.querySelector('.pv-top-card--list-bullet li:first-child');

    const name = nameEl?.innerText?.trim() ?? null;
    const title = titleEl?.innerText?.trim() ?? null;
    const company = companyEl?.innerText?.trim() ?? null;

    // Split name into first/last
    const parts = name ? name.split(' ') : [];
    const firstName = parts[0] ?? null;
    const lastName = parts.slice(1).join(' ') || null;

    return { firstName, lastName, title, company, profileUrl: window.location.href };
}

// Listen for popup requesting data
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_PROFILE') {
        sendResponse(extractProfile());
    }
});
